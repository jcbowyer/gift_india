"""Scrape Model ABDM facilities from the ABDM Insights dashboard (public API).

The National Health Authority publishes end-to-end ABDM adoption pilot facilities
through the ABDM Insights dashboard at ``dashboardbeta.abdm.gov.in``. The Angular
UI calls unauthenticated JSON endpoints on ``/abdmservice/api/dashboard/modelabdm/``:

  * ``abdmData``            — facility list (``MODELABDMFACILITIES``)
  * ``facilityHprOverview`` — HPR registration / verification metrics per facility
  * ``HRL``                 — Health Record Linking counts (state drill-down)

Unlike NHPR (``src.nhpr_scraper``), no integrator credentials are required. The
scraper merges the three payloads by normalized facility name and optionally
enriches rows that carry an HFR id via the public NHPR ``facilityDetail`` API.

Output::

    data/abdm/
    ├── facilities_abdm.json   # one record per model / pilot ABDM facility
    ├── manifest.json          # run summary
    └── _partial.jsonl         # checkpoint (removed after a full run)

Examples
--------
Pull the full model-facility set into data/abdm/::

    python -m src.abdm_scraper

Offline fixture run (no network)::

    python -m src.abdm_scraper --fixture-dir tests/fixtures/abdm

Enrich HFR ids with NHPR facilityDetail (slower, best-effort)::

    python -m src.abdm_scraper --enrich-nhpr
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import re
import socket
import ssl
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from loguru import logger

from .jci_scraper import brand_key, normalize_name

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_OUT_DIR = DATA_DIR / "abdm"
DATA_SOURCE = "abdm"

DASHBOARD_BASE = "https://dashboardbeta.abdm.gov.in/abdmservice/api/dashboard/modelabdm"
ABDM_DATA_URL = f"{DASHBOARD_BASE}/abdmData"
HPR_OVERVIEW_URL = f"{DASHBOARD_BASE}/facilityHprOverview"
HRL_URL = f"{DASHBOARD_BASE}/HRL"
SOURCE_PAGE = "https://dashboardbeta.abdm.gov.in/abdm/model-abdm"

BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
DEFAULT_TIMEOUT = 60.0
DEFAULT_DELAY = 0.25
DEFAULT_RETRIES = 3

_NAME_ALIASES = (
    (re.compile(r"\bg\.?\s*g\.?\s*h\.?\b", re.I), "government general hospital"),
    (re.compile(r"\bggh\b", re.I), "government general hospital"),
)


@dataclass
class AbdmSummary:
    out_dir: str
    collected_at: str
    total: int
    with_hfr_id: int
    with_hrl: int
    with_hpr: int
    with_nhpr_detail: int
    states_scanned: int
    records_path: str | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _normalize_lookup(name: str) -> str:
    """Aggressive name key for cross-endpoint merging."""
    text = name or ""
    if not re.search(r"institute of medical sciences", text, re.I):
        text = re.sub(r"\baiims\b", "all india institute of medical sciences", text, flags=re.I)
    text = re.sub(r"\([^)]*\)", " ", text)
    for pattern, repl in _NAME_ALIASES:
        if pattern.pattern != r"\baiims\b":
            text = pattern.sub(repl, text)
    key = normalize_name(text)
    key = re.sub(r"[^a-z0-9]+", " ", key).strip()
    return re.sub(r"\s+", " ", key)


def _stable_id(*, hfr_id: str | None, name: str) -> str:
    if hfr_id:
        return hfr_id.strip()
    digest = hashlib.sha256(_normalize_lookup(name).encode()).hexdigest()[:16]
    return f"abdm-{digest}"


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return None


def _resolve_host(hostname: str) -> str:
    """Resolve hostname; fall back to DNS-over-HTTPS when system DNS fails (common on WSL)."""
    try:
        return socket.gethostbyname(hostname)
    except OSError:
        pass
    doh_url = f"https://cloudflare-dns.com/dns-query?name={hostname}&type=A"
    req = urllib.request.Request(doh_url, headers={"Accept": "application/dns-json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    for answer in payload.get("Answer") or []:
        if answer.get("type") == 1:
            return answer["data"]
    raise OSError(f"Could not resolve {hostname}")


def _https_json_post(url: str, payload: dict[str, Any], *, timeout: float) -> dict[str, Any]:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError(f"Expected https URL, got {url}")
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "User-Agent": BROWSER_USER_AGENT,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Host": parsed.hostname,
        "Content-Length": str(len(body)),
    }
    address = _resolve_host(parsed.hostname)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    context = ssl.create_default_context()
    sock = socket.create_connection((address, 443), timeout=timeout)
    try:
        ssl_sock = context.wrap_socket(sock, server_hostname=parsed.hostname)
        conn = http.client.HTTPSConnection(parsed.hostname)
        conn.sock = ssl_sock
        conn.request("POST", path, body=body, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        if resp.status >= 400:
            raise urllib.error.HTTPError(url, resp.status, resp.reason, resp.headers, raw)
        return json.loads(raw.decode("utf-8"))
    finally:
        try:
            ssl_sock.close()
        except Exception:  # noqa: BLE001
            sock.close()


class AbdmClient:
    """Minimal client for the ABDM Insights dashboard JSON APIs."""

    def __init__(
        self,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        retries: int = DEFAULT_RETRIES,
        delay: float = DEFAULT_DELAY,
    ):
        self.timeout = timeout
        self.retries = retries
        self.delay = delay

    def _post(self, url: str, payload: dict[str, Any]) -> dict[str, Any]:
        last_err: Exception | None = None
        for attempt in range(1, self.retries + 1):
            try:
                data = _https_json_post(url, payload, timeout=self.timeout)
                if self.delay:
                    time.sleep(self.delay)
                return data
            except Exception as exc:  # noqa: BLE001 — retry loop
                last_err = exc
                logger.warning(
                    "ABDM POST {} attempt {}/{} failed: {}",
                    urlparse(url).path.rsplit("/", 1)[-1],
                    attempt,
                    self.retries,
                    exc,
                )
                time.sleep(min(2 ** attempt, 8))
        raise RuntimeError(f"ABDM request failed after {self.retries} attempts") from last_err

    def model_facility_names(self) -> list[str]:
        data = self._post(
            ABDM_DATA_URL,
            {"type": "MODELABDMFACILITIES", "state_code": "", "partner": ""},
        )
        names: list[str] = []
        for row in data.get("list") or []:
            name = (row.get("hospitalName") or row.get("value") or "").strip()
            if name:
                names.append(name)
        return names

    def hpr_overview(self) -> list[dict[str, Any]]:
        data = self._post(
            HPR_OVERVIEW_URL,
            {
                "type": "HPR_OVERVIEW",
                "state_code": "",
                "facility": "",
                "profType": "",
                "abhalState": "",
            },
        )
        return list(data.get("list") or [])

    def hrl_state_names(self) -> list[str]:
        data = self._post(
            HRL_URL,
            {
                "type": "HRL_STATEWISE",
                "state_code": "",
                "facility": "",
                "profType": "",
                "abhalState": "",
            },
        )
        states: list[str] = []
        for row in data.get("list") or []:
            name = (row.get("stateName") or "").strip()
            if name and name != "Not Yet Updated":
                states.append(name)
        return states

    def hrl_facilities_for_state(self, state_name: str) -> list[dict[str, Any]]:
        data = self._post(
            HRL_URL,
            {
                "type": "HRL_STATEWISE",
                "state_code": state_name,
                "facility": "",
                "profType": "",
                "abhalState": "",
            },
        )
        rows: list[dict[str, Any]] = []
        for row in data.get("list") or []:
            if (row.get("hospitalName") or "").strip():
                enriched = dict(row)
                enriched["state"] = state_name
                rows.append(enriched)
        return rows

    def all_hrl_facilities(self) -> list[dict[str, Any]]:
        all_rows: list[dict[str, Any]] = []
        for state in self.hrl_state_names():
            all_rows.extend(self.hrl_facilities_for_state(state))
        return all_rows


def _merge_records(
    *,
    model_names: list[str],
    hpr_rows: list[dict[str, Any]],
    hrl_rows: list[dict[str, Any]],
    collected_at: str,
) -> list[dict[str, Any]]:
    """Union model-facility names with HPR + HRL dashboard payloads."""
    by_key: dict[str, dict[str, Any]] = {}

    def _ensure(key: str, name: str) -> dict[str, Any]:
        if key not in by_key:
            match = normalize_name(name)
            by_key[key] = {
                "abdm_facility_id": _stable_id(hfr_id=None, name=name),
                "facility_name": name.strip(),
                "hfr_id": None,
                "facility_type": None,
                "state": None,
                "district": None,
                "partner_name": None,
                "initiative_status": None,
                "declared_doctors": None,
                "declared_nurses": None,
                "declared_hpr_total": None,
                "verified_doctors": None,
                "verified_nurses": None,
                "verified_hpr_total": None,
                "hrl_linked_count": None,
                "is_model_abdm_facility": False,
                "hpr_json": None,
                "hrl_json": None,
                "nhpr_json": None,
                "match_name": match,
                "brand_key": brand_key(match),
                "verified_on_portal": True,
                "source": "abdm_dashboard",
                "source_url": SOURCE_PAGE,
                "data_source": DATA_SOURCE,
                "collected_at": collected_at,
            }
        return by_key[key]

    for name in model_names:
        key = _normalize_lookup(name)
        rec = _ensure(key, name)
        rec["is_model_abdm_facility"] = True

    for row in hpr_rows:
        name = (row.get("hospitalName") or "").strip()
        if not name:
            continue
        key = _normalize_lookup(name)
        rec = _ensure(key, name)
        hfr_id = (row.get("hospitalId") or "").strip() or None
        if hfr_id:
            rec["hfr_id"] = hfr_id
            rec["abdm_facility_id"] = _stable_id(hfr_id=hfr_id, name=name)
        rec["facility_type"] = (row.get("origin") or rec["facility_type"] or "").strip() or None
        rec["initiative_status"] = (row.get("status") or rec["initiative_status"] or "").strip() or None
        rec["declared_doctors"] = _as_int(row.get("value"))
        rec["declared_nurses"] = _as_int(row.get("value2"))
        rec["declared_hpr_total"] = _as_int(row.get("value3"))
        rec["verified_doctors"] = _as_int(row.get("hprTotal"))
        rec["verified_nurses"] = _as_int(row.get("linkedCount"))
        rec["verified_hpr_total"] = _as_int(row.get("hidCount"))
        rec["hpr_json"] = row

    for row in hrl_rows:
        name = (row.get("hospitalName") or "").strip()
        if not name:
            continue
        key = _normalize_lookup(name)
        rec = _ensure(key, name)
        hfr_id = (row.get("hospitalId") or "").strip() or None
        if hfr_id and not rec.get("hfr_id"):
            rec["hfr_id"] = hfr_id
            rec["abdm_facility_id"] = _stable_id(hfr_id=hfr_id, name=name)
        rec["state"] = row.get("state") or rec.get("state")
        rec["district"] = (row.get("districtName") or rec.get("district") or "").strip() or None
        rec["partner_name"] = (row.get("partnerName") or rec.get("partner_name") or "").strip() or None
        rec["hrl_linked_count"] = _as_int(row.get("linkedCount"))
        rec["hrl_json"] = row

    # Stable sort for reproducible output.
    return sorted(by_key.values(), key=lambda r: (r["facility_name"].lower(), r["abdm_facility_id"]))


def _load_fixture(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _maybe_enrich_nhpr(records: list[dict[str, Any]], *, delay: float) -> int:
    """Best-effort NHPR facilityDetail enrichment for rows with an HFR id."""
    from .nhpr_client import NhprClient, NhprConfig

    client = NhprClient(NhprConfig.from_env())
    enriched = 0
    for rec in records:
        hfr_id = rec.get("hfr_id")
        if not hfr_id or rec.get("nhpr_json"):
            continue
        try:
            detail = client.facility_detail(hfr_id)
            if detail:
                rec["nhpr_json"] = detail
                facility = detail.get("facility") if isinstance(detail.get("facility"), dict) else detail
                rec["state"] = rec.get("state") or facility.get("stateName") or facility.get("state_name")
                rec["district"] = rec.get("district") or facility.get("districtName") or facility.get("district_name")
                rec["facility_type"] = (
                    rec.get("facility_type")
                    or facility.get("facilityType")
                    or facility.get("facility_type")
                )
                enriched += 1
        except Exception as exc:  # noqa: BLE001 — enrichment is optional
            logger.debug("NHPR detail skipped for {}: {}", hfr_id, exc)
        if delay:
            time.sleep(delay)
    return enriched


def collect(
    out_dir: Path = DEFAULT_OUT_DIR,
    *,
    enrich_nhpr: bool = False,
    fixture_dir: Path | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    delay: float = DEFAULT_DELAY,
    retries: int = DEFAULT_RETRIES,
) -> AbdmSummary:
    """Scrape model ABDM facilities and write ``facilities_abdm.json``."""
    collected_at = _now_iso()
    out_dir.mkdir(parents=True, exist_ok=True)
    records_path = out_dir / "facilities_abdm.json"
    manifest_path = out_dir / "manifest.json"

    if fixture_dir:
        model_names = _load_fixture(fixture_dir / "model_facilities.json")
        hpr_rows = _load_fixture(fixture_dir / "hpr_overview.json")
        hrl_rows = _load_fixture(fixture_dir / "hrl_facilities.json")
        states_scanned = len({r.get("state") for r in hrl_rows if r.get("state")})
    else:
        client = AbdmClient(timeout=timeout, delay=delay, retries=retries)
        model_names = client.model_facility_names()
        hpr_rows = client.hpr_overview()
        states = client.hrl_state_names()
        hrl_rows = client.all_hrl_facilities()
        states_scanned = len(states)

    records = _merge_records(
        model_names=model_names,
        hpr_rows=hpr_rows,
        hrl_rows=hrl_rows,
        collected_at=collected_at,
    )

    nhpr_enriched = 0
    if enrich_nhpr and not fixture_dir:
        nhpr_enriched = _maybe_enrich_nhpr(records, delay=delay)

    records_path.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")

    summary = AbdmSummary(
        out_dir=str(out_dir),
        collected_at=collected_at,
        total=len(records),
        with_hfr_id=sum(1 for r in records if r.get("hfr_id")),
        with_hrl=sum(1 for r in records if r.get("hrl_linked_count") is not None),
        with_hpr=sum(1 for r in records if r.get("hpr_json")),
        with_nhpr_detail=nhpr_enriched,
        states_scanned=states_scanned,
        records_path=str(records_path),
    )
    manifest_path.write_text(json.dumps(asdict(summary), indent=2), encoding="utf-8")
    logger.info(
        "ABDM model facilities: {} rows ({} with HFR id, {} with HRL, {} NHPR-enriched)",
        summary.total,
        summary.with_hfr_id,
        summary.with_hrl,
        summary.with_nhpr_detail,
    )
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help=f"Output directory (default: {DEFAULT_OUT_DIR}).",
    )
    parser.add_argument(
        "--fixture-dir",
        type=Path,
        help="Offline fixture directory (tests/fixtures/abdm).",
    )
    parser.add_argument(
        "--enrich-nhpr",
        action="store_true",
        help="Fetch NHPR facilityDetail for rows with an HFR id (best-effort).",
    )
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY)
    parser.add_argument("--retries", type=int, default=DEFAULT_RETRIES)
    args = parser.parse_args(argv)

    collect(
        args.out_dir,
        enrich_nhpr=args.enrich_nhpr,
        fixture_dir=args.fixture_dir,
        timeout=args.timeout,
        delay=args.delay,
        retries=args.retries,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
