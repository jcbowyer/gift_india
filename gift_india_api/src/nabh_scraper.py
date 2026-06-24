"""Scrape the NABH accredited-healthcare-organisation directory and stage it for bronze.

The National Accreditation Board for Hospitals & Healthcare Providers (NABH,
`nabh.co`) publishes every NABH-accredited, -certified, or -empanelled facility in
India through the "Find an Accredited Healthcare Organisation" directory. Unlike the
JCI portal (which 403s bulk export and forced a curated seed — see
``src.jci_scraper``), the NABH directory is backed by an **unauthenticated WordPress
admin-ajax endpoint** that returns the whole national set page by page:

    POST https://nabh.co/wp-admin/admin-ajax.php
    form: action=get_hospitals&page=<n>&selectedSpecText=<specialty|empty>

The JSON response carries three things per page:

  * ``pagination`` — ``{total_pages, current_page, total_results}`` (≈19k orgs / 775 pages)
  * ``html``       — server-rendered cards: HCO name, address, contact, accreditation
                     (reference) number, programme, and the Accredited/Empaneled/Certified
                     status badge, plus a link to the certificate-and-scope PDF.
  * ``mapData``    — ``{name, lat, lng, address}`` for the geocoded subset of the page.

For every organization we emit a stable ``nabh_org_id`` plus the same
**entity-resolution keys** (``match_name`` + ``brand_key``) the JCI flow uses, so the
downstream join to the governed Virtue Foundation facilities — and the
``jci_normalize`` dbt macro — are shared verbatim between the two accreditation
sources. ``city``/``state`` are recovered from the free-text address with a state
gazetteer (the dbt ``state_codes`` seed) rather than brittle positional slicing.

Output (mirrors ``src.jci_scraper``)::

    data/nabh/
    ├── nabh_accredited.json   # one record per accredited/certified/empanelled org (+ keys)
    └── manifest.json          # run summary: counts, pages, by-status breakdown, resume cursor

The crawl is **resumable**: completed pages are checkpointed to ``_partial.jsonl`` and
the last finished page is recorded in the manifest, so ``--resume`` continues a run
that was interrupted partway through the 775 pages.

Examples
--------
Pull the full national directory into data/nabh/ (≈19k orgs)::

    python -m src.nabh_scraper

Resume an interrupted run, or pull just the first few pages while testing::

    python -m src.nabh_scraper --resume
    python -m src.nabh_scraper --max-pages 3
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from loguru import logger

# Reuse the JCI normalization so both accreditation sources resolve to facilities
# with identical entity-resolution keys (and the shared `jci_normalize` dbt macro).
from .jci_scraper import brand_key, normalize_name

# Repo-root data/ (where virtue/, jci/, … live), NOT the api package's data/.
DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_OUT_DIR = DATA_DIR / "nabh"
# Canonical state list, shared with the dbt `state_codes` seed, used to recover
# city/state from the directory's free-text address strings.
STATE_SEED = (
    Path(__file__).resolve().parents[2]
    / "gift_india_dbt" / "seeds" / "state_codes.csv"
)

DATA_SOURCE = "nabh"
ENDPOINT = "https://nabh.co/wp-admin/admin-ajax.php"
DIRECTORY_URL = "https://nabh.co/find-a-healthcare-organisation/"
# admin-ajax serves automated fetches fine, but mimic the site's own XHR.
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
DEFAULT_TIMEOUT = 30.0
DEFAULT_DELAY = 0.4
DEFAULT_RETRIES = 4

# Fallback gazetteer if the dbt seed is ever unavailable (states + union territories).
_FALLBACK_STATES = {
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
    "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
    "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
    "Ladakh", "Lakshadweep", "Puducherry",
}

_PIN_RE = re.compile(r"\b(\d{6})\b")
_REF_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]*[-/]")


@dataclass
class NabhOrg:
    """One NABH-accredited / -certified / -empanelled healthcare organization."""

    nabh_org_id: str
    nabh_name: str
    city: str | None
    state: str | None
    pincode: str | None
    country: str
    accreditation_program: str | None     # e.g. "Hospitals", "SHCO", "AYUSH Hospitals"
    accreditation_status: str | None       # "Accredited" | "Empaneled" | "Certified"
    reference_no: str | None               # NABH accreditation/reference number
    certificate_url: str | None            # stable portal cert PDF (null if expiring presigned)
    address: str | None
    website_url: str | None
    phone: str | None
    lat: float | None
    lng: float | None
    match_name: str
    brand_key: str
    source: str
    source_url: str
    verified_on_portal: bool               # these ARE the official portal → always true
    data_source: str
    collected_at: str


@dataclass
class NabhSummary:
    out_dir: str
    collected_at: str
    total: int
    total_results_reported: int
    pages_fetched: int
    total_pages: int
    last_page: int
    by_status: dict[str, int] = field(default_factory=dict)
    by_program: dict[str, int] = field(default_factory=dict)
    geocoded: int = 0
    records_path: str | None = None
    endpoint: str = ENDPOINT


# --------------------------------------------------------------- helpers
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _org_id(name: str, city: str | None, state: str | None, ref: str | None) -> str:
    """Stable id. Reference number disambiguates same-name orgs across programmes."""
    import hashlib

    key = "|".join([
        normalize_name(name),
        (city or "").strip().lower(),
        (state or "").strip().lower(),
        (ref or "").strip().lower(),
    ])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def load_states(path: Path = STATE_SEED) -> dict[str, str]:
    """Lower-cased state name → canonical name, from the dbt ``state_codes`` seed."""
    states = dict.fromkeys(_FALLBACK_STATES)
    canon = {s: s for s in states}
    if path.exists():
        with path.open(newline="", encoding="utf-8") as fh:
            canon = {row["state"].strip(): row["state"].strip()
                     for row in csv.DictReader(fh) if row.get("state")}
    return {name.lower(): name for name in canon}


def parse_address(address: str, states_lookup: dict[str, str]) -> tuple[str | None, str | None, str | None]:
    """Recover ``(city, state, pincode)`` from a free-text NABH address.

    NABH addresses are inconsistent (some end ``…, City, State, Pincode``, some
    ``…, State, India`` with no city, some have no commas at all), so we locate the
    state by gazetteer — the right-most comma part that contains a known state name —
    and take the nearest preceding non-pincode part as the city. Far more robust than
    positional slicing.
    """
    if not address:
        return None, None, None
    parts = [p.strip() for p in address.split(",") if p.strip()]
    pin_match = _PIN_RE.search(address)
    pincode = pin_match.group(1) if pin_match else None

    state = city = None
    state_idx = None
    for i in range(len(parts) - 1, -1, -1):
        low = parts[i].lower()
        for state_low, canonical in states_lookup.items():
            if re.search(r"\b" + re.escape(state_low) + r"\b", low):
                state, state_idx = canonical, i
                break
        if state:
            break
    if state_idx is not None:
        for j in range(state_idx - 1, -1, -1):
            if parts[j].strip() and not re.fullmatch(r"\d{6}", parts[j]):
                city = parts[j]
                break
    return city, state, pincode


def _program_from_cert(href: str | None) -> str | None:
    """Programme from the certificate path ``…/Documents/AccreditedList/<PROGRAM>/…``."""
    if not href:
        return None
    m = re.search(r"/Documents/[^/]+/([^/]+)/", href)
    return m.group(1).strip() if m else None


def _stable_cert_url(href: str | None) -> str | None:
    """Keep only stable portal cert URLs; drop expiring presigned S3 links and ``#``."""
    if not href or href.strip() in {"#", ""}:
        return None
    if "X-Amz-" in href or "amazonaws.com" in href:
        return None
    return href.strip()


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


# --------------------------------------------------------------- parse one page
def parse_page(payload: dict, states_lookup: dict[str, str], *, collected_at: str) -> list[NabhOrg]:
    """Parse one ``get_hospitals`` JSON payload into :class:`NabhOrg` records."""
    soup = BeautifulSoup(payload.get("html", "") or "", "html.parser")
    cards = soup.select("div.organisation-list.hp-body-row")

    # mapData → geo, keyed by the (tab-prefixed) name the cards also use.
    geo: dict[str, tuple[float | None, float | None]] = {}
    for m in payload.get("mapData") or []:
        nm = (m.get("name") or "").strip().lower()
        if nm and nm not in geo:
            geo[nm] = (m.get("lat"), m.get("lng"))

    orgs: list[NabhOrg] = []
    for card in cards:
        name_a = card.select_one(".hs-col-1 a")
        name = _clean(name_a.get_text()) if name_a else _clean(
            (card.select_one(".hs-col-1") or card).get_text()
        )
        if not name:
            continue
        cert_href = name_a.get("href") if name_a else None

        address = _clean(card.select_one(".hs-col-2").get_text()) if card.select_one(".hs-col-2") else None
        city, state, pincode = parse_address(address or "", states_lookup)

        website = phone = None
        col3 = card.select_one(".hs-col-3")
        if col3:
            for a in col3.select("a[href]"):
                href = a["href"]
                if href.startswith("tel:") and not phone:
                    phone = href[4:].strip()
                elif href.startswith("http") and not website:
                    website = href.strip()
            if not phone:
                pm = re.search(r"\+?\d[\d ]{7,}\d", _clean(col3.get_text()))
                phone = pm.group(0).strip() if pm else None

        reference_no = _clean(
            card.select_one(".hs-col-4").get_text()
        ).replace("Acc. No.", "").strip() if card.select_one(".hs-col-4") else None
        reference_no = reference_no or None

        status = _clean(card.select_one(".hs-col-5").get_text()) if card.select_one(".hs-col-5") else None
        status = status or None

        program = _program_from_cert(cert_href)
        lat, lng = geo.get(name.strip().lower(), (None, None))

        orgs.append(NabhOrg(
            nabh_org_id=_org_id(name, city, state, reference_no),
            nabh_name=name,
            city=city,
            state=state,
            pincode=pincode,
            country="India",
            accreditation_program=program,
            accreditation_status=status,
            reference_no=reference_no,
            certificate_url=_stable_cert_url(cert_href),
            address=address,
            website_url=website,
            phone=phone,
            lat=lat,
            lng=lng,
            match_name=normalize_name(name),
            brand_key=brand_key(name),
            source="nabh_directory",
            source_url=DIRECTORY_URL,
            verified_on_portal=True,
            data_source=DATA_SOURCE,
            collected_at=collected_at,
        ))
    return orgs


# --------------------------------------------------------------- fetch
def fetch_page(session: requests.Session, page: int, *, specialty: str = "",
               timeout: float = DEFAULT_TIMEOUT, retries: int = DEFAULT_RETRIES) -> dict:
    """POST one page of the directory, retrying transient failures with backoff."""
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.post(
                ENDPOINT,
                data={"action": "get_hospitals", "page": page, "selectedSpecText": specialty},
                headers={"X-Requested-With": "XMLHttpRequest"},
                timeout=timeout,
            )
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:  # noqa: PERF203
            last_exc = exc
            wait = min(2 ** attempt, 30)
            logger.warning("Page {} attempt {}/{} failed ({}); retrying in {}s",
                           page, attempt, retries, exc, wait)
            time.sleep(wait)
    raise RuntimeError(f"NABH page {page} failed after {retries} attempts: {last_exc}")


# --------------------------------------------------------------- collect
def _load_partial(partial_path: Path) -> dict[str, dict]:
    """Read checkpointed records (JSONL) keyed by nabh_org_id, for --resume."""
    by_id: dict[str, dict] = {}
    if partial_path.exists():
        for line in partial_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            by_id[rec["nabh_org_id"]] = rec
    return by_id


def collect(out_dir: Path = DEFAULT_OUT_DIR, *, max_pages: int | None = None,
            start_page: int = 1, delay: float = DEFAULT_DELAY,
            timeout: float = DEFAULT_TIMEOUT, retries: int = DEFAULT_RETRIES,
            resume: bool = False) -> NabhSummary:
    """Page through the NABH directory and write ``nabh_accredited.json`` + a manifest."""
    collected_at = _now_iso()
    out_dir.mkdir(parents=True, exist_ok=True)
    partial_path = out_dir / "_partial.jsonl"
    states_lookup = load_states()

    by_id: dict[str, dict] = {}
    page = start_page
    if resume:
        by_id = _load_partial(partial_path)
        manifest_path = out_dir / "manifest.json"
        if manifest_path.exists():
            prev = json.loads(manifest_path.read_text(encoding="utf-8"))
            page = max(start_page, int(prev.get("last_page", 0)) + 1)
        logger.info("Resuming from page {} with {} record(s) already on disk", page, len(by_id))
    else:
        partial_path.unlink(missing_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": BROWSER_USER_AGENT, "Accept": "application/json"})

    first = fetch_page(session, page, timeout=timeout, retries=retries)
    pagination = first.get("pagination") or {}
    total_pages = int(pagination.get("total_pages") or page)
    total_results = int(pagination.get("total_results") or 0)
    last_page_target = total_pages if max_pages is None else min(total_pages, page + max_pages - 1)
    logger.info("NABH directory: {} orgs across {} pages; fetching {}..{}",
                total_results, total_pages, page, last_page_target)

    pages_fetched = 0
    last_page = page - 1
    with partial_path.open("a", encoding="utf-8") as partial_fh:
        current_payload = first
        while page <= last_page_target:
            if current_payload is None:
                current_payload = fetch_page(session, page, timeout=timeout, retries=retries)
            for org in parse_page(current_payload, states_lookup, collected_at=collected_at):
                rec = asdict(org)
                if org.nabh_org_id not in by_id:
                    partial_fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                by_id[org.nabh_org_id] = rec
            partial_fh.flush()
            pages_fetched += 1
            last_page = page
            if page % 25 == 0 or page == last_page_target:
                logger.info("…page {}/{} — {} unique org(s) so far", page, last_page_target, len(by_id))
            page += 1
            current_payload = None
            if page <= last_page_target:
                time.sleep(delay)

    records = sorted(by_id.values(), key=lambda r: (
        (r.get("state") or "~"), (r.get("city") or "~"), r.get("nabh_name") or ""))
    records_path = out_dir / "nabh_accredited.json"
    records_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

    by_status: dict[str, int] = {}
    by_program: dict[str, int] = {}
    geocoded = 0
    for r in records:
        by_status[r.get("accreditation_status") or "unknown"] = \
            by_status.get(r.get("accreditation_status") or "unknown", 0) + 1
        by_program[r.get("accreditation_program") or "unknown"] = \
            by_program.get(r.get("accreditation_program") or "unknown", 0) + 1
        if r.get("lat") is not None and r.get("lng") is not None:
            geocoded += 1

    summary = NabhSummary(
        out_dir=str(out_dir),
        collected_at=collected_at,
        total=len(records),
        total_results_reported=total_results,
        pages_fetched=pages_fetched,
        total_pages=total_pages,
        last_page=last_page,
        by_status=dict(sorted(by_status.items())),
        by_program=dict(sorted(by_program.items(), key=lambda kv: -kv[1])),
        geocoded=geocoded,
        records_path=str(records_path),
    )
    (out_dir / "manifest.json").write_text(
        json.dumps(asdict(summary), ensure_ascii=False, indent=2), encoding="utf-8")
    # Full set written successfully; the resume checkpoint is no longer needed.
    if last_page >= total_pages:
        partial_path.unlink(missing_ok=True)
    logger.success(
        "Collected {} NABH org(s) ({} geocoded) across {} page(s) → {}",
        summary.total, geocoded, pages_fetched, records_path)
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR,
                        help=f"Output directory (default: {DEFAULT_OUT_DIR}).")
    parser.add_argument("--max-pages", type=int,
                        help="Only fetch this many pages (default: all ~775).")
    parser.add_argument("--start-page", type=int, default=1,
                        help="First page to fetch (default: 1).")
    parser.add_argument("--resume", action="store_true",
                        help="Continue from the last finished page using the checkpoint.")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY,
                        help=f"Seconds between page requests (default: {DEFAULT_DELAY}).")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT,
                        help=f"Per-request timeout in seconds (default: {DEFAULT_TIMEOUT}).")
    parser.add_argument("--retries", type=int, default=DEFAULT_RETRIES,
                        help=f"Retries per page on failure (default: {DEFAULT_RETRIES}).")
    args = parser.parse_args(argv)

    collect(out_dir=args.out, max_pages=args.max_pages, start_page=args.start_page,
            delay=args.delay, timeout=args.timeout, retries=args.retries,
            resume=args.resume)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
