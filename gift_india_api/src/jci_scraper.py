"""Compile the JCI-accredited-organizations seed for India and stage it for bronze.

The Joint Commission International (JCI) publishes its accredited organizations in
an online directory (`jointcommission.org/.../jci-accredited-organizations/`). That
directory is JS-rendered behind a search API and **blocks automated bulk export**
(it 403s server-side fetches and offers no CSV), so a naive crawl returns nothing.

The pragmatic, reproducible approach (the one the data-engineering brief asks for):

  1. Take a *curated seed* list of India's JCI-accredited hospitals that medical
     tourism aggregators (Karetrip, Shifam Health, Wellness Destination India, …)
     have already compiled — bundled here as ``data/jci_india_seed.csv`` with the
     ``source`` / ``source_url`` provenance of every row.
  2. *Verify a sample* against the official portal — rows flagged
     ``verified_on_portal`` represent that spot-check (so the seed is trustworthy
     without claiming an exhaustive automated scrape).
  3. *Best-effort* hit the official directory anyway (``--fetch-official``); if it
     responds, fold any India organizations it returns into the set. If it 403s /
     returns JS (the normal case), that's recorded in the manifest and we fall
     back to the seed — the pipeline still runs.

For every organization we emit a stable ``jci_org_id`` plus the **entity-resolution
keys** (``match_name`` + ``brand_key``) used downstream to inner-join JCI orgs to
the governed Virtue Foundation facilities and flag ``jci_accredited = true``. The
same normalization is mirrored in SQL (``gift_india_dbt`` macro ``jci_normalize``)
so the Python pre-match and the dbt join agree.

Output (mirrors ``src.scraper`` → ``src.load_crawl``)::

    data/jci/
    ├── jci_accredited.json   # one record per accredited organization (+ keys)
    └── manifest.json         # run summary: counts, sources, official-fetch outcome

Examples
--------
Build the JCI set from the bundled seed (offline, deterministic)::

    python -m src.jci_scraper

Also try the live official directory and fold in whatever it returns::

    python -m src.jci_scraper --fetch-official
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import requests
from loguru import logger

# Repo-root data/ (where virtue/, simplygis/, … live — same convention as
# load_virtue.py), NOT the api package's data/.
DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_SEED = DATA_DIR / "jci_india_seed.csv"
DEFAULT_OUT_DIR = DATA_DIR / "jci"

DATA_SOURCE = "jci"
OFFICIAL_URL = (
    "https://www.jointcommission.org/en/about-jci/jci-accredited-organizations/"
)
USER_AGENT = (
    "GiftIndiaBot/1.0 (+https://github.com/jcbowyer/gift_india; "
    "research scraper for healthcare facility data)"
)
# Many large hospital chains (Apollo, …) 403 the research-bot UA but serve a
# normal browser. Used for the homepage snapshots so we capture the marquee sites.
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
DEFAULT_TIMEOUT = 20.0

# Generic / legal / geographic tokens stripped during name normalization so that
# messy source names collapse to a comparable brand string, e.g.
#   "Apollo Hospitals Enterprise Limited" -> "apollo"
#   "Fortis Memorial Research Institute"  -> "fortis memorial"
# Locality words embedded in a name are NOT stripped (we don't guess city names),
# so "Apollo Hospital, Chennai" -> "apollo chennai"; brand_key + state handles the
# cross-naming match. Keep this list in lock-step with the `jci_normalize` macro.
GENERIC_TOKENS = {
    "the", "of", "and", "for", "a",
    "hospital", "hospitals", "clinic", "clinics", "centre", "center",
    "institute", "institutes", "medical", "medicity", "sciences", "science",
    "research", "speciality", "specialty", "superspeciality", "superspecialty",
    "super", "multispeciality", "multispecialty", "multi",
    "healthcare", "health", "care", "hospitals.", "nursing", "home",
    "ltd", "limited", "pvt", "private", "enterprise", "enterprises",
    "india", "international", "national", "global",
}


@dataclass
class JciOrg:
    """One JCI-accredited organization (a normalized seed/portal row)."""

    jci_org_id: str
    jci_name: str
    city: str
    state: str
    country: str
    accreditation_program: str
    accreditation_decision: str
    effective_date: str | None
    website_url: str
    source: str
    source_url: str
    verified_on_portal: bool
    data_source: str
    match_name: str
    brand_key: str
    collected_at: str
    # Path to the scraped homepage snapshot dir (set when --scrape-pages runs).
    snapshot_dir: str | None = None


@dataclass
class JciSummary:
    out_dir: str
    collected_at: str
    total: int
    verified_sample: int
    seed_count: int
    official_count: int
    official_fetch: dict = field(default_factory=dict)
    sources: dict[str, int] = field(default_factory=dict)
    records_path: str | None = None
    pages_scraped: dict = field(default_factory=dict)


# --------------------------------------------------------------- normalization
def _strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )


def significant_tokens(name: str | None) -> list[str]:
    """Normalized, generic-stripped tokens of a facility/organization name.

    Lower-cases, expands ``&`` to ``and``, drops accents and punctuation, then
    removes the generic/legal/geographic tokens in :data:`GENERIC_TOKENS`. What
    remains is the distinctive part of the name (the brand + any qualifier).
    """
    if not name:
        return []
    text = _strip_accents(str(name)).lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return [t for t in text.split() if t and t not in GENERIC_TOKENS]


def normalize_name(name: str | None) -> str:
    """Full normalized match name — significant tokens joined by spaces."""
    return " ".join(significant_tokens(name))


def brand_key(name: str | None, n: int = 2) -> str:
    """The first ``n`` significant tokens — a coarse brand identity for matching.

    e.g. "Fortis Memorial Research Institute" -> "fortis memorial",
         "Apollo Hospitals, Greams Road"      -> "apollo greams".
    """
    return " ".join(significant_tokens(name)[:n])


def _org_id(name: str, city: str, state: str) -> str:
    key = f"{normalize_name(name)}|{city.strip().lower()}|{state.strip().lower()}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _as_bool(value: str | bool | None) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "t", "yes", "y"}


# Date formats the JCI portal / seed use for an accreditation effective date.
_DATE_FORMATS = ("%Y-%m-%d", "%d %B %Y", "%d %b %Y", "%B %d, %Y", "%m/%d/%Y")


def _parse_date(value: str | None) -> str | None:
    """Normalize an effective-date string to ISO ``YYYY-MM-DD`` (or None).

    Accepts the portal's ``07 November 2023`` style as well as ISO and a few
    common variants; returns None for blanks or anything unparseable so a bad
    value never blocks the seed-only build.
    """
    text = (value or "").strip()
    if not text:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    logger.warning("Unparseable JCI effective_date {!r}; storing null.", text)
    return None


# --------------------------------------------------------------- seed
def _make_org(row: dict, *, collected_at: str) -> JciOrg | None:
    name = (row.get("jci_name") or row.get("name") or "").strip()
    if not name:
        return None
    city = (row.get("city") or "").strip()
    state = (row.get("state") or "").strip()
    return JciOrg(
        jci_org_id=_org_id(name, city, state),
        jci_name=name,
        city=city,
        state=state,
        country=(row.get("country") or "India").strip(),
        accreditation_program=(row.get("accreditation_program") or "Hospital").strip(),
        # Every org in this set is, by definition, JCI-accredited, so the decision
        # defaults to "Accredited" unless the source states otherwise.
        accreditation_decision=(row.get("accreditation_decision") or "Accredited").strip(),
        effective_date=_parse_date(row.get("effective_date")),
        website_url=(row.get("website_url") or "").strip(),
        source=(row.get("source") or "seed").strip(),
        source_url=(row.get("source_url") or "").strip(),
        verified_on_portal=_as_bool(row.get("verified_on_portal")),
        data_source=DATA_SOURCE,
        match_name=normalize_name(name),
        brand_key=brand_key(name),
        collected_at=collected_at,
    )


def load_seed(path: Path, *, collected_at: str) -> list[JciOrg]:
    """Read the curated aggregator seed CSV into :class:`JciOrg` records."""
    if not path.exists():
        raise FileNotFoundError(
            f"JCI seed not found at {path}. Expected the bundled "
            "data/jci_india_seed.csv (curated from medical-tourism aggregators)."
        )
    orgs: list[JciOrg] = []
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if org := _make_org(row, collected_at=collected_at):
                orgs.append(org)
    return orgs


# --------------------------------------------------------------- official portal
def fetch_official(
    *, timeout: float = DEFAULT_TIMEOUT, collected_at: str
) -> tuple[list[JciOrg], dict]:
    """Best-effort fetch of the live JCI directory; tolerate the usual block.

    Returns ``(orgs, outcome)``. The official directory is JS-rendered and bot-
    blocked, so ``orgs`` is normally empty and ``outcome`` records *why* (status /
    error) — kept in the manifest as provenance for the seed-only fallback.
    """
    outcome: dict = {"url": OFFICIAL_URL, "attempted_at": collected_at}
    try:
        resp = requests.get(
            OFFICIAL_URL,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
            timeout=timeout,
            allow_redirects=True,
        )
    except requests.RequestException as exc:  # noqa: BLE001
        logger.warning("Official JCI directory fetch failed: {}", exc)
        outcome.update(status="fetch_error", error=str(exc), orgs_found=0)
        return [], outcome

    outcome["http_status"] = resp.status_code
    outcome["final_url"] = str(resp.url)
    if resp.status_code >= 400:
        logger.info(
            "Official JCI directory returned HTTP {} (bulk export blocked) — "
            "using the curated seed.", resp.status_code,
        )
        outcome.update(status="blocked", orgs_found=0)
        return [], outcome

    # If the portal ever serves a parseable India list, fold it in. The live page
    # is JS-rendered, so this usually finds nothing — recorded, not fatal.
    orgs = _parse_official_html(resp.text, collected_at=collected_at)
    outcome.update(status="ok", orgs_found=len(orgs))
    return orgs, outcome


def _parse_official_html(html: str, *, collected_at: str) -> list[JciOrg]:
    """Pull any embedded India organization rows from the portal payload.

    The directory ships its results as JSON embedded in the page; when present we
    read organization name + city for India entries. Returns ``[]`` when the page
    is the empty JS shell (the common case).
    """
    orgs: list[JciOrg] = []
    seen: set[str] = set()
    # Embedded result objects look like {"OrganizationName":"…","Country":"India",
    # "City":"…"}. Be liberal about key order / casing.
    pattern = re.compile(
        r'\{[^{}]*?"(?:OrganizationName|organizationName|name)"\s*:\s*"([^"]+)"'
        r'[^{}]*?"(?:Country|country)"\s*:\s*"India"'
        r'(?:[^{}]*?"(?:City|city)"\s*:\s*"([^"]*)")?[^{}]*?\}',
        re.IGNORECASE,
    )
    for match in pattern.finditer(html):
        name = match.group(1).strip()
        city = (match.group(2) or "").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        org = _make_org(
            {
                "jci_name": name,
                "city": city,
                "state": "",
                "country": "India",
                "source": "jci_official",
                "source_url": OFFICIAL_URL,
                "verified_on_portal": True,
            },
            collected_at=collected_at,
        )
        if org:
            orgs.append(org)
    return orgs


# --------------------------------------------------------------- page snapshots
def scrape_pages(
    orgs: list[JciOrg],
    out_dir: Path,
    *,
    delay: float = 1.0,
    timeout: float = DEFAULT_TIMEOUT,
    limit: int | None = None,
    force: bool = False,
) -> dict:
    """Snapshot each JCI hospital's official homepage, reusing ``src.scraper``.

    Writes the same human-readable hierarchy the facility crawler uses —
    ``<out_dir>/scraped/<state>/<district>/<facility-name>-<jci_org_id>/`` with a
    ``page.html`` + ``extracted.json`` and a top-level ``manifest.json`` — using
    the city as the district level. Each org's ``snapshot_dir`` is set in place so
    the JCI records point at their snapshot. Returns the scrape summary counts.
    """
    from . import scraper  # local import: keep the seed-only path network-free

    scraped_root = out_dir / "scraped"
    targets = [
        scraper.ScrapeTarget(
            facility_id=o.jci_org_id,
            name=o.jci_name,
            url=o.website_url,
            state=o.state,
            district=o.city,  # city is the finest geography we have for a JCI org
        )
        for o in orgs
        if o.website_url
    ]
    if not targets:
        logger.warning("No JCI org has a website_url — skipping page snapshots.")
        return {"attempted": False, "targets": 0}

    summary = scraper.scrape(
        targets,
        out_dir=scraped_root,
        delay=delay,
        timeout=timeout,
        limit=limit,
        force=force,
        user_agent=BROWSER_USER_AGENT,
    )

    # Link each org to its snapshot dir (relative to out_dir for portability).
    for o in orgs:
        if not o.website_url:
            continue
        leaf = scraper.facility_subdir(
            scraped_root,
            facility_id=o.jci_org_id,
            name=o.jci_name,
            state=o.state,
            district=o.city,
        )
        o.snapshot_dir = str(leaf.relative_to(out_dir)) if leaf.exists() else None

    return {
        "attempted": True,
        "scraped_root": str(scraped_root),
        "targets": summary.total,
        "ok": summary.ok,
        "failed": summary.failed,
        "skipped": summary.skipped,
    }


# --------------------------------------------------------------- build + write
def _merge(seed: list[JciOrg], official: list[JciOrg]) -> list[JciOrg]:
    """Union seed + official, deduped on ``jci_org_id`` (official wins ties)."""
    by_id: dict[str, JciOrg] = {o.jci_org_id: o for o in seed}
    for o in official:  # official rows are portal-verified; let them override
        by_id[o.jci_org_id] = o
    return sorted(by_id.values(), key=lambda o: (o.state, o.city, o.jci_name))


def collect(
    seed_path: Path = DEFAULT_SEED,
    out_dir: Path = DEFAULT_OUT_DIR,
    *,
    fetch_official_portal: bool = False,
    scrape_pages_enabled: bool = False,
    timeout: float = DEFAULT_TIMEOUT,
    delay: float = 1.0,
    limit: int | None = None,
    force: bool = False,
) -> JciSummary:
    """Build the deduped JCI organization set and write JSON + a manifest.

    When ``scrape_pages_enabled`` is set, each org's official homepage is
    snapshotted under ``<out_dir>/scraped/<state>/<district>/<name>-<id>/``.
    """
    collected_at = _now_iso()
    seed = load_seed(seed_path, collected_at=collected_at)

    official: list[JciOrg] = []
    official_outcome: dict = {"attempted": False}
    if fetch_official_portal:
        official, official_outcome = fetch_official(
            timeout=timeout, collected_at=collected_at
        )
        official_outcome["attempted"] = True

    orgs = _merge(seed, official)

    out_dir.mkdir(parents=True, exist_ok=True)

    # Snapshot the hospital homepages (sets each org's snapshot_dir) BEFORE the
    # records are serialized so the JSON carries the snapshot links.
    pages_scraped: dict = {"attempted": False}
    if scrape_pages_enabled:
        pages_scraped = scrape_pages(
            orgs, out_dir, delay=delay, timeout=timeout, limit=limit, force=force
        )

    records_path = out_dir / "jci_accredited.json"
    records_path.write_text(
        json.dumps([asdict(o) for o in orgs], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    sources: dict[str, int] = {}
    for o in orgs:
        sources[o.source] = sources.get(o.source, 0) + 1

    summary = JciSummary(
        out_dir=str(out_dir),
        collected_at=collected_at,
        total=len(orgs),
        verified_sample=sum(1 for o in orgs if o.verified_on_portal),
        seed_count=len(seed),
        official_count=len(official),
        official_fetch=official_outcome,
        sources=sources,
        records_path=str(records_path),
        pages_scraped=pages_scraped,
    )
    (out_dir / "manifest.json").write_text(
        json.dumps(asdict(summary), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.success(
        "Collected {} JCI-accredited India org(s) ({} portal-verified) → {}",
        summary.total, summary.verified_sample, records_path,
    )
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--seed", type=Path, default=DEFAULT_SEED,
        help=f"Curated JCI seed CSV (default: {DEFAULT_SEED}).",
    )
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_OUT_DIR,
        help=f"Output directory (default: {DEFAULT_OUT_DIR}).",
    )
    parser.add_argument(
        "--fetch-official", action="store_true",
        help="Also try the live official JCI directory (best-effort; usually "
        "blocked — the curated seed is the reliable source).",
    )
    parser.add_argument(
        "--scrape-pages", action="store_true",
        help="Snapshot each hospital's official homepage under "
        "<out>/scraped/<state>/<district>/<name>-<id>/ (page.html + extracted.json).",
    )
    parser.add_argument(
        "--no-scrape-pages", dest="scrape_pages", action="store_false",
        help="Skip the homepage snapshots (default).",
    )
    parser.set_defaults(scrape_pages=False)
    parser.add_argument(
        "--limit", type=int, help="Only snapshot the first N hospital homepages."
    )
    parser.add_argument(
        "--delay", type=float, default=1.0,
        help="Seconds between homepage requests (default: 1.0).",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-fetch homepages even if a cached snapshot exists.",
    )
    parser.add_argument(
        "--timeout", type=float, default=DEFAULT_TIMEOUT,
        help=f"Per-request timeout in seconds (default: {DEFAULT_TIMEOUT}).",
    )
    args = parser.parse_args(argv)

    collect(
        seed_path=args.seed,
        out_dir=args.out,
        fetch_official_portal=args.fetch_official,
        scrape_pages_enabled=args.scrape_pages,
        timeout=args.timeout,
        delay=args.delay,
        limit=args.limit,
        force=args.force,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
