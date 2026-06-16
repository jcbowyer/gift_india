"""Scrape PMJAY empanelled hospitals from the official HEM public search portal.

The National Health Authority publishes every Ayushman Bharat (PM-JAY) empanelled
hospital through the Hospital Empanelment Module (HEM) search UI:

    https://hospitals.pmjay.gov.in/Search/empnlWorkFlow.htm?actionFlag=ViewRegisteredHosptlsNew

Unlike the NABH directory (which exposes a clean JSON admin-ajax API — see
``src.nabh_scraper``), the PMJAY portal is a classic Struts form workflow. Bulk
export is done by replaying the same POST the browser sends when a user clicks
*Search*, with ``appReadOnly=Y`` (read-only listing mode used by researchers and
the PLOS One empanelment study) and paging through ``pageNo``.

For every state → district combination the scraper requests the hospital list,
parses the HTML results table, and emits a stable ``pmjay_org_id`` plus the same
**entity-resolution keys** (``match_name`` + ``brand_key``) the JCI / NABH flows
use so downstream dbt joins are shared.

Output (mirrors ``src.nabh_scraper``)::

    data/bronze_pmjay/
    ├── facilities_pmjay.json   # one record per empanelled hospital (+ keys)
    ├── state_districts.json    # cached portal state/district code map
    ├── manifest.json           # run summary + resume cursor
    └── _partial.jsonl          # checkpoint (removed after a full run)

The crawl is **resumable**: completed (state, district) pairs are checkpointed to
``_partial.jsonl`` and the manifest records the last finished pair.

Examples
--------
Pull the full national directory into data/bronze_pmjay/::

    python -m src.pmjay_scraper

Dry-run against bundled HTML fixtures (no network)::

    python -m src.pmjay_scraper --fixture-dir tests/fixtures/pmjay

Resume an interrupted run, or scope a test pull::

    python -m src.pmjay_scraper --resume
    python -m src.pmjay_scraper --state Karnataka --max-districts 2
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup
from loguru import logger

from .jci_scraper import brand_key, normalize_name
from .nabh_scraper import load_states, parse_address

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_OUT_DIR = DATA_DIR / "bronze_pmjay"

DATA_SOURCE = "pmjay"
PMJAY_HOST = os.environ.get("PMJAY_HOST", "hospitals.pmjay.gov.in")
WORKFLOW_URL = f"https://{PMJAY_HOST}/Search/empnlWorkFlow.htm"
SEARCH_URL = (
    f"https://{PMJAY_HOST}/Search/empnlWorkFlow.htm"
    "?actionFlag=ViewRegisteredHosptlsNew"
)
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
DEFAULT_TIMEOUT = 60.0
DEFAULT_DELAY = 0.5
DEFAULT_RETRIES = 4

# Sentinel values the portal uses for "all" filters.
ALL_TYPES = "-1"
ALL_SPECIALITIES = "-1"
ALL_EMPANEL_TYPES = "-1"

# actionFlag values observed / documented for dependent dropdowns.
_DISTRICT_ACTION_FLAGS = (
    "getDistrictList",
    "populateDistrict",
    "populateDistrictList",
    "LoadDistrict",
    "ViewDistrictList",
)

# Header tokens → canonical field names for flexible table parsing.
_HEADER_ALIASES: dict[str, str] = {
    "sno": "sno",
    "s no": "sno",
    "serial": "sno",
    "hospital name": "name",
    "facility name": "name",
    "name": "name",
    "hospital type": "hospital_type",
    "type": "hospital_type",
    "category": "hospital_type",
    "address": "address",
    "hospital address": "address",
    "contact": "phone",
    "contact no": "phone",
    "contact number": "phone",
    "phone": "phone",
    "mobile": "phone",
    "email": "email",
    "e mail": "email",
    "empanelled specialities": "specialties",
    "empanelled specialties": "specialties",
    "specialities": "specialties",
    "specialties": "specialties",
    "upgraded specialities": "specialties_upgraded",
    "upgraded specialties": "specialties_upgraded",
    "nabh": "nabh_status",
    "nabh status": "nabh_status",
    "bed": "bed_strength",
    "bed strength": "bed_strength",
    "beds": "bed_strength",
    "ehcp": "hecp_id",
    "hospital id": "hecp_id",
    "empanelment": "empanelment_scheme",
    "scheme": "empanelment_scheme",
}


@dataclass
class PmjayHospital:
    """One PM-JAY empanelled hospital from the HEM public search portal."""

    pmjay_org_id: str
    pmjay_name: str
    hecp_id: str | None
    hospital_type: str | None
    district: str | None
    state: str | None
    pincode: str | None
    country: str
    address: str | None
    email: str | None
    phone: str | None
    specialties: str
    specialties_upgraded: str
    empanelment_scheme: str | None
    nabh_status: str | None
    bed_strength: int | None
    lat: float | None
    lng: float | None
    pmjay_state_code: str | None
    pmjay_district_code: str | None
    match_name: str
    brand_key: str
    source: str
    source_url: str
    verified_on_portal: bool
    data_source: str
    collected_at: str


@dataclass
class PmjaySummary:
    out_dir: str
    collected_at: str
    total: int
    states_scanned: int
    districts_scanned: int
    pages_fetched: int
    last_state_code: str | None = None
    last_state_name: str | None = None
    last_district_code: str | None = None
    last_district_name: str | None = None
    by_hospital_type: dict[str, int] = field(default_factory=dict)
    by_state: dict[str, int] = field(default_factory=dict)
    records_path: str | None = None
    workflow_url: str = WORKFLOW_URL


# --------------------------------------------------------------- helpers
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _norm_header(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", text.lower()).strip()


def _org_id(
    name: str,
    district: str | None,
    state: str | None,
    hecp_id: str | None,
    address: str | None,
) -> str:
    key = "|".join([
        normalize_name(name),
        (district or "").strip().lower(),
        (state or "").strip().lower(),
        (hecp_id or "").strip().lower(),
        normalize_name(address or ""),
    ])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _pipe_list(raw: str | None) -> str:
    """Normalise a delimited specialty string to pipe-separated tokens."""
    if not raw:
        return ""
    parts = re.split(r"[|,;/]+", raw)
    tokens = [_clean(p) for p in parts if _clean(p)]
    return "|".join(dict.fromkeys(tokens))


def _parse_int(raw: str | None) -> int | None:
    if not raw:
        return None
    m = re.search(r"\d+", raw.replace(",", ""))
    return int(m.group(0)) if m else None


def parse_select_options(html: str, select_name: str) -> list[tuple[str, str]]:
    """Parse ``<select name=…>`` options as ``[(value, label), …]``."""
    soup = BeautifulSoup(html, "html.parser")
    select = soup.find("select", attrs={"name": select_name})
    if select is None:
        select = soup.find("select", attrs={"id": select_name})
    if select is None:
        return []
    options: list[tuple[str, str]] = []
    for opt in select.find_all("option"):
        value = _clean(opt.get("value"))
        label = _clean(opt.get_text())
        if not value or value in {"-1", "0", ""}:
            continue
        if label.lower().startswith("select"):
            continue
        options.append((value, label))
    return options


def _header_map(header_cells: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for idx, cell in enumerate(header_cells):
        key = _HEADER_ALIASES.get(_norm_header(cell))
        if key and key not in mapping:
            mapping[key] = idx
    return mapping


def _cell(row: list[str], mapping: dict[str, int], key: str) -> str | None:
    idx = mapping.get(key)
    if idx is None or idx >= len(row):
        return None
    val = _clean(row[idx])
    return val or None


def parse_results_html(
    html: str,
    *,
    state_name: str | None,
    district_name: str | None,
    state_code: str | None,
    district_code: str | None,
    states_lookup: dict[str, str],
    collected_at: str,
) -> list[PmjayHospital]:
    """Parse one PMJAY search-results HTML page into hospital records."""
    soup = BeautifulSoup(html, "html.parser")
    hospitals: list[PmjayHospital] = []

    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        header_cells = [_clean(c.get_text()) for c in rows[0].find_all(["th", "td"])]
        mapping = _header_map(header_cells)
        if "name" not in mapping:
            continue

        for tr in rows[1:]:
            cells = [_clean(c.get_text()) for c in tr.find_all(["td", "th"])]
            if not cells or all(not c for c in cells):
                continue
            name = _cell(cells, mapping, "name")
            if not name or name.lower() in {"hospital name", "no record found"}:
                continue

            address = _cell(cells, mapping, "address")
            city, parsed_state, pincode = parse_address(address or "", states_lookup)
            state = state_name or parsed_state
            district = district_name or city

            hecp_id = _cell(cells, mapping, "hecp_id")
            hospitals.append(PmjayHospital(
                pmjay_org_id=_org_id(name, district, state, hecp_id, address),
                pmjay_name=name,
                hecp_id=hecp_id,
                hospital_type=_cell(cells, mapping, "hospital_type"),
                district=district,
                state=state,
                pincode=pincode,
                country="India",
                address=address,
                email=_cell(cells, mapping, "email"),
                phone=_cell(cells, mapping, "phone"),
                specialties=_pipe_list(_cell(cells, mapping, "specialties")),
                specialties_upgraded=_pipe_list(
                    _cell(cells, mapping, "specialties_upgraded")
                ),
                empanelment_scheme=_cell(cells, mapping, "empanelment_scheme"),
                nabh_status=_cell(cells, mapping, "nabh_status"),
                bed_strength=_parse_int(_cell(cells, mapping, "bed_strength")),
                lat=None,
                lng=None,
                pmjay_state_code=state_code,
                pmjay_district_code=district_code,
                match_name=normalize_name(name),
                brand_key=brand_key(name),
                source="pmjay_hem_search",
                source_url=SEARCH_URL,
                verified_on_portal=True,
                data_source=DATA_SOURCE,
                collected_at=collected_at,
            ))
    return hospitals


def parse_total_pages(html: str) -> int | None:
    """Best-effort page count from 'Page X of Y' / 'Total Pages : Y' text."""
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    for pattern in (
        r"page\s+\d+\s+of\s+(\d+)",
        r"total\s+pages?\s*[:\-]?\s*(\d+)",
        r"page\s+(\d+)\s*/\s*\d+",
    ):
        m = re.search(pattern, text, flags=re.I)
        if m:
            return int(m.group(1))
    return None


def build_search_params(
    *,
    state_code: str,
    district_code: str,
    page_no: int,
    hosp_type: str = ALL_TYPES,
    speciality: str = ALL_SPECIALITIES,
    empanel_type: str = ALL_EMPANEL_TYPES,
    hosp_name: str = "",
) -> dict[str, str]:
    """Build the PMJAY HEM search query the portal expects."""
    return {
        "actionFlag": "ViewRegisteredHosptlsNew",
        "search": "Y",
        "appReadOnly": "Y",
        "pageNo": str(page_no),
        "searchState": state_code,
        "searchDistrict": district_code,
        "searchHospType": hosp_type,
        "searchSpeciality": speciality,
        "searchEmpanelType": empanel_type,
        "searchHospName": hosp_name,
    }


# --------------------------------------------------------------- network
def _is_dns_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    if "failed to resolve" in msg or "name resolution" in msg or "getaddrinfo failed" in msg:
        return True
    if isinstance(exc, socket.gaierror):
        return True
    cause = getattr(exc, "__cause__", None)
    return bool(cause and _is_dns_error(cause))


def _dns_help(host: str = PMJAY_HOST) -> str:
    return (
        f"Cannot reach the PMJAY portal host ({host}) — DNS lookup failed in this environment.\n"
        "  • WSL DNS fix:  echo 'nameserver 8.8.8.8' | sudo tee /etc/resolv.conf\n"
        "  • Offline test: make pmjay-scrape FIXTURE=1 && make load-pmjay\n"
        "  • Override host: PMJAY_HOST=<reachable-host> make pmjay-scrape"
    )


def _assert_host_resolvable(host: str = PMJAY_HOST) -> None:
    try:
        socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise RuntimeError(_dns_help(host)) from exc


def _request(
    session: requests.Session,
    *,
    method: str,
    params: dict[str, str] | None = None,
    timeout: float,
    retries: int,
    label: str,
) -> str:
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            if method.upper() == "POST":
                resp = session.post(WORKFLOW_URL, data=params, timeout=timeout)
            else:
                resp = session.get(WORKFLOW_URL, params=params, timeout=timeout)
            resp.raise_for_status()
            resp.encoding = resp.apparent_encoding or "utf-8"
            return resp.text
        except requests.RequestException as exc:  # noqa: PERF203
            last_exc = exc
            if _is_dns_error(exc):
                break
            wait = min(2 ** attempt, 30)
            logger.warning(
                "{} attempt {}/{} failed ({}); retrying in {}s",
                label, attempt, retries, exc, wait,
            )
            time.sleep(wait)
    if last_exc and _is_dns_error(last_exc):
        raise RuntimeError(_dns_help()) from last_exc
    raise RuntimeError(f"{label} failed after {retries} attempts: {last_exc}")


def fetch_form_page(session: requests.Session, **kwargs: Any) -> str:
    return _request(
        session,
        method="GET",
        params={"actionFlag": "ViewRegisteredHosptlsNew"},
        label="PMJAY form page",
        **kwargs,
    )


def fetch_states(session: requests.Session, **kwargs: Any) -> list[tuple[str, str]]:
    html = fetch_form_page(session, **kwargs)
    options = parse_select_options(html, "searchState")
    if not options:
        raise RuntimeError(
            "Could not parse state dropdown from the PMJAY search form. "
            "The portal markup may have changed."
        )
    return options


def fetch_districts(
    session: requests.Session,
    state_code: str,
    **kwargs: Any,
) -> list[tuple[str, str]]:
    """Return district ``(code, name)`` pairs for a PMJAY state code."""
    for action_flag in _DISTRICT_ACTION_FLAGS:
        html = _request(
            session,
            method="GET",
            params={"actionFlag": action_flag, "searchState": state_code},
            label=f"PMJAY districts ({action_flag})",
            **kwargs,
        )
        options = parse_select_options(html, "searchDistrict")
        if options:
            return options

    # Some builds return the full form with the district list pre-rendered.
    html = _request(
        session,
        method="GET",
        params={
            "actionFlag": "ViewRegisteredHosptlsNew",
            "searchState": state_code,
        },
        label="PMJAY form (state preset)",
        **kwargs,
    )
    options = parse_select_options(html, "searchDistrict")
    if options:
        return options

    logger.warning(
        "No districts returned for state {}; falling back to state-wide search only",
        state_code,
    )
    return [(ALL_TYPES, "ALL")]


def fetch_search_page(
    session: requests.Session,
    params: dict[str, str],
    **kwargs: Any,
) -> str:
    return _request(
        session,
        method="POST",
        params=params,
        label=f"PMJAY search state={params.get('searchState')} "
              f"district={params.get('searchDistrict')} page={params.get('pageNo')}",
        **kwargs,
    )


# --------------------------------------------------------------- collect
def _load_partial(partial_path: Path) -> dict[str, dict]:
    by_id: dict[str, dict] = {}
    if partial_path.exists():
        for line in partial_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            by_id[rec["pmjay_org_id"]] = rec
    return by_id


def _load_state_districts(path: Path) -> dict[str, list[dict[str, str]]]:
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return raw.get("districts_by_state", raw)


def _save_state_districts(
    path: Path,
    states: list[tuple[str, str]],
    districts_by_state: dict[str, list[dict[str, str]]],
) -> None:
    payload = {
        "collected_at": _now_iso(),
        "states": [{"code": code, "name": name} for code, name in states],
        "districts_by_state": districts_by_state,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _matches_filter(name: str | None, needle: str | None) -> bool:
    if not needle:
        return True
    return needle.strip().lower() in (name or "").strip().lower()


def collect(
    out_dir: Path = DEFAULT_OUT_DIR,
    *,
    state_filter: str | None = None,
    district_filter: str | None = None,
    max_states: int | None = None,
    max_districts: int | None = None,
    delay: float = DEFAULT_DELAY,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    resume: bool = False,
    fixture_dir: Path | None = None,
) -> PmjaySummary:
    """Crawl the PMJAY HEM portal and write ``facilities_pmjay.json`` + manifest."""
    collected_at = _now_iso()
    out_dir.mkdir(parents=True, exist_ok=True)
    partial_path = out_dir / "_partial.jsonl"
    districts_cache_path = out_dir / "state_districts.json"
    states_lookup = load_states()

    by_id: dict[str, dict] = {}
    resume_state = resume_district = None
    if resume:
        by_id = _load_partial(partial_path)
        manifest_path = out_dir / "manifest.json"
        if manifest_path.exists():
            prev = json.loads(manifest_path.read_text(encoding="utf-8"))
            resume_state = prev.get("last_state_code")
            resume_district = prev.get("last_district_code")
        logger.info(
            "Resuming with {} record(s); cursor state={} district={}",
            len(by_id), resume_state, resume_district,
        )
    else:
        partial_path.unlink(missing_ok=True)

    pages_fetched = 0
    districts_scanned = 0
    states_scanned = 0
    last_state_code = last_state_name = None
    last_district_code = last_district_name = None
    districts_by_state: dict[str, list[dict[str, str]]] = _load_state_districts(
        districts_cache_path
    )

    if fixture_dir is not None:
        states = [(s["code"], s["name"]) for s in _load_fixture_states(fixture_dir)]
        session = None
    else:
        _assert_host_resolvable()
        session = requests.Session()
        session.headers.update({
            "User-Agent": BROWSER_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
        })
        states = fetch_states(session, timeout=timeout, retries=retries)

    if state_filter:
        states = [(c, n) for c, n in states if _matches_filter(n, state_filter)]
    if max_states is not None:
        states = states[:max_states]

    skipping = resume_state is not None
    with partial_path.open("a", encoding="utf-8") as partial_fh:
        for state_code, state_name in states:
            if skipping:
                if state_code != resume_state:
                    continue
                skipping = False

            states_scanned += 1
            if state_code not in districts_by_state:
                if fixture_dir is not None:
                    districts = _load_fixture_districts(fixture_dir, state_code)
                else:
                    districts = fetch_districts(
                        session, state_code, timeout=timeout, retries=retries,
                    )
                districts_by_state[state_code] = [
                    {"code": code, "name": name} for code, name in districts
                ]
                _save_state_districts(districts_cache_path, states, districts_by_state)

            district_pairs = [
                (d["code"], d["name"]) for d in districts_by_state[state_code]
            ]
            if district_filter:
                district_pairs = [
                    (c, n) for c, n in district_pairs if _matches_filter(n, district_filter)
                ]
            if max_districts is not None:
                district_pairs = district_pairs[:max_districts]

            district_skipping = resume_district is not None and state_code == resume_state
            for district_code, district_name in district_pairs:
                if district_skipping:
                    if district_code != resume_district:
                        continue
                    district_skipping = False
                    resume_district = None

                districts_scanned += 1
                page_no = 1
                total_pages: int | None = None
                while True:
                    params = build_search_params(
                        state_code=state_code,
                        district_code=district_code,
                        page_no=page_no,
                    )
                    if fixture_dir is not None:
                        html = _load_fixture_search(
                            fixture_dir, state_code, district_code, page_no,
                        )
                    else:
                        html = fetch_search_page(
                            session, params, timeout=timeout, retries=retries,
                        )
                    pages_fetched += 1

                    page_hospitals = parse_results_html(
                        html,
                        state_name=state_name,
                        district_name=None if district_code == ALL_TYPES else district_name,
                        state_code=state_code,
                        district_code=district_code,
                        states_lookup=states_lookup,
                        collected_at=collected_at,
                    )
                    for hosp in page_hospitals:
                        rec = asdict(hosp)
                        if hosp.pmjay_org_id not in by_id:
                            partial_fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                        by_id[hosp.pmjay_org_id] = rec
                    partial_fh.flush()

                    if total_pages is None:
                        total_pages = parse_total_pages(html)
                    if not page_hospitals:
                        break
                    if total_pages is not None and page_no >= total_pages:
                        break
                    if total_pages is None:
                        break
                    page_no += 1
                    if fixture_dir is None:
                        time.sleep(delay)

                last_state_code, last_state_name = state_code, state_name
                last_district_code, last_district_name = district_code, district_name
                if fixture_dir is None:
                    time.sleep(delay)

    records = sorted(
        by_id.values(),
        key=lambda r: (
            (r.get("state") or "~"),
            (r.get("district") or "~"),
            r.get("pmjay_name") or "",
        ),
    )
    records_path = out_dir / "facilities_pmjay.json"
    records_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8",
    )

    by_hospital_type: dict[str, int] = {}
    by_state: dict[str, int] = {}
    for r in records:
        ht = r.get("hospital_type") or "unknown"
        by_hospital_type[ht] = by_hospital_type.get(ht, 0) + 1
        st = r.get("state") or "unknown"
        by_state[st] = by_state.get(st, 0) + 1

    summary = PmjaySummary(
        out_dir=str(out_dir),
        collected_at=collected_at,
        total=len(records),
        states_scanned=states_scanned,
        districts_scanned=districts_scanned,
        pages_fetched=pages_fetched,
        last_state_code=last_state_code,
        last_state_name=last_state_name,
        last_district_code=last_district_code,
        last_district_name=last_district_name,
        by_hospital_type=dict(sorted(by_hospital_type.items())),
        by_state=dict(sorted(by_state.items(), key=lambda kv: -kv[1])),
        records_path=str(records_path),
    )
    (out_dir / "manifest.json").write_text(
        json.dumps(asdict(summary), ensure_ascii=False, indent=2), encoding="utf-8",
    )
    partial_path.unlink(missing_ok=True)

    logger.success(
        "Collected {} PMJAY hospital(s) across {} state(s), {} district(s), {} page(s) → {}",
        summary.total, states_scanned, districts_scanned, pages_fetched, records_path,
    )
    return summary


# --------------------------------------------------------------- fixtures
def _load_fixture_states(fixture_dir: Path) -> list[dict[str, str]]:
    return json.loads((fixture_dir / "states.json").read_text(encoding="utf-8"))


def _load_fixture_districts(
    fixture_dir: Path, state_code: str,
) -> list[tuple[str, str]]:
    path = fixture_dir / "districts" / f"{state_code}.html"
    if not path.exists():
        return [("-1", "ALL")]
    html = path.read_text(encoding="utf-8")
    return parse_select_options(html, "searchDistrict")


def _load_fixture_search(
    fixture_dir: Path,
    state_code: str,
    district_code: str,
    page_no: int,
) -> str:
    path = (
        fixture_dir / "results" / state_code / district_code / f"page_{page_no}.html"
    )
    if not path.exists():
        return "<html><body><table><tr><th>Hospital Name</th></tr></table></body></html>"
    return path.read_text(encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR,
                        help=f"Output directory (default: {DEFAULT_OUT_DIR}).")
    parser.add_argument("--state", help="Only scrape states whose name contains this.")
    parser.add_argument("--district", help="Only scrape districts whose name contains this.")
    parser.add_argument("--max-states", type=int, help="Cap the number of states.")
    parser.add_argument("--max-districts", type=int,
                        help="Cap districts per state (for test runs).")
    parser.add_argument("--resume", action="store_true",
                        help="Continue from the last finished state/district pair.")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY,
                        help=f"Seconds between requests (default: {DEFAULT_DELAY}).")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT,
                        help=f"Per-request timeout in seconds (default: {DEFAULT_TIMEOUT}).")
    parser.add_argument("--retries", type=int, default=DEFAULT_RETRIES,
                        help=f"Retries per request on failure (default: {DEFAULT_RETRIES}).")
    parser.add_argument(
        "--fixture-dir", type=Path,
        help="Use bundled HTML fixtures instead of the live portal (offline tests).",
    )
    args = parser.parse_args(argv)

    collect(
        out_dir=args.out,
        state_filter=args.state,
        district_filter=args.district,
        max_states=args.max_states,
        max_districts=args.max_districts,
        delay=args.delay,
        timeout=args.timeout,
        retries=args.retries,
        resume=args.resume,
        fixture_dir=args.fixture_dir,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
