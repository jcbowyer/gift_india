"""Scrape registered hospitals from the NHPR public web directory (no API token).

The National Health Provider Registry (``nhpr.abdm.gov.in``) publishes facility
search and detail through the same JSON endpoints the portal UI calls. This
scraper drives those public XHR endpoints with browser-like headers (no
integrator Bearer token), filters to **hospital** facility types, and enriches
each record via ``facilityDetail`` plus HTML profile parsing for bed counts.

  1. Iterates Indian states (bundled LGD gazetteer + live master when reachable).
  2. Searches state-by-state with hospital-oriented name tokens.
  3. Filters to hospital facility types.
  4. Fetches ``facilityDetail`` (+ HTML fallback) for bed / infrastructure fields.
  5. Writes resumable JSONL checkpoints and ``nhpr_hospitals.json``.

Output::

    data/nhpr/
    ├── nhpr_hospitals.json
    ├── manifest.json
    └── _partial.jsonl

Examples
--------
Scrape hospitals nationally (no credentials needed)::

    python -m src.nhpr_scraper

Offline fixture run::

    python -m src.nhpr_scraper --fixture-dir tests/fixtures/nhpr

Resume or cap scope while testing::

    python -m src.nhpr_scraper --resume
    python -m src.nhpr_scraper --max-states 2 --search-tokens hospital
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from loguru import logger

from .jci_scraper import brand_key, normalize_name
from .nhpr_client import (
    NhprClient,
    NhprConfig,
    flatten_facility,
    is_hospital_record,
)

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_OUT_DIR = DATA_DIR / "nhpr"
DATA_SOURCE = "nhpr"

# Ownership codes accepted by the HFR search API (private + government + PPP).
DEFAULT_OWNERSHIP_CODES = ("P", "G", "PP")

# Name tokens that surface hospitals in fuzzy search without enumerating every facility.
DEFAULT_SEARCH_TOKENS = (
    "hospital",
    "multi",
    "medical",
    "health",
    "care",
    "memorial",
    "institute",
    *tuple(chr(c) for c in range(ord("a"), ord("z") + 1)),
)


@dataclass
class NhprSummary:
    out_dir: str
    collected_at: str
    total: int
    hospitals: int
    with_beds: int
    states_scanned: int
    ownership_codes: list[str]
    search_tokens: list[str]
    last_state_code: str | None = None
    last_ownership: str | None = None
    last_token: str | None = None
    records_path: str | None = None
    endpoint_detail: str = "/nhpr/v4/search/facility/facilityDetail"
    endpoint_search: str = "/nhpr/v4/search/facility/facilitySearch"
    used_legacy_api: bool = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_partial(partial_path: Path) -> dict[str, dict]:
    by_id: dict[str, dict] = {}
    if partial_path.exists():
        for line in partial_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            by_id[rec["nhpr_facility_id"]] = rec
    return by_id


def _load_fixture_states(fixture_dir: Path) -> list[dict]:
    states_path = fixture_dir / "lgd_states.json"
    return json.loads(states_path.read_text(encoding="utf-8"))


def _load_fixture_search(fixture_dir: Path, token: str) -> dict:
    path = fixture_dir / "search" / f"{token}.json"
    if not path.exists():
        return {"facilities": [], "numberOfPages": 1}
    return json.loads(path.read_text(encoding="utf-8"))


def _load_fixture_detail(fixture_dir: Path, facility_id: str) -> dict:
    path = fixture_dir / "details" / f"{facility_id}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def collect(
    out_dir: Path = DEFAULT_OUT_DIR,
    *,
    ownership_codes: tuple[str, ...] = DEFAULT_OWNERSHIP_CODES,
    search_tokens: tuple[str, ...] = DEFAULT_SEARCH_TOKENS,
    max_states: int | None = None,
    max_pages_per_query: int | None = None,
    results_per_page: int = 100,
    resume: bool = False,
    hospitals_only: bool = True,
    fixture_dir: Path | None = None,
    config: NhprConfig | None = None,
) -> NhprSummary:
    """Crawl NHPR hospitals and write ``nhpr_hospitals.json`` + manifest."""
    collected_at = _now_iso()
    out_dir.mkdir(parents=True, exist_ok=True)
    partial_path = out_dir / "_partial.jsonl"
    manifest_path = out_dir / "manifest.json"

    by_id: dict[str, dict] = {}
    start_state_idx = 0
    start_ownership_idx = 0
    start_token_idx = 0

    if resume and partial_path.exists():
        by_id = _load_partial(partial_path)
        if manifest_path.exists():
            prev = json.loads(manifest_path.read_text(encoding="utf-8"))
            codes = prev.get("states_scanned_list") or []
            start_state_idx = len(codes)
            start_ownership_idx = int(prev.get("last_ownership_idx") or 0)
            start_token_idx = int(prev.get("last_token_idx") or 0) + 1
        logger.info(
            "Resuming with {} record(s); state_idx={} ownership_idx={} token_idx={}",
            len(by_id), start_state_idx, start_ownership_idx, start_token_idx,
        )
    elif not resume:
        partial_path.unlink(missing_ok=True)

    client = NhprClient(config=config) if fixture_dir is None else None
    if fixture_dir is not None:
        states = _load_fixture_states(fixture_dir)
    else:
        assert client is not None
        states = client.fetch_lgd_states()

    if max_states is not None:
        states = states[start_state_idx : start_state_idx + max_states]
    else:
        states = states[start_state_idx:]

    states_scanned: list[str] = []
    if resume and manifest_path.exists():
        prev = json.loads(manifest_path.read_text(encoding="utf-8"))
        states_scanned = list(prev.get("states_scanned_list") or [])

    with partial_path.open("a", encoding="utf-8") as partial_fh:
        for state in states:
            state_code = str(state.get("code") or state.get("stateLGDCode") or "")
            state_name = state.get("name") or state.get("stateName") or state_code
            if not state_code:
                continue
            logger.info("Scanning state {} ({})", state_name, state_code)
            states_scanned.append(state_code)

            ownership_start = start_ownership_idx if state == states[0] else 0
            for oi, ownership in enumerate(ownership_codes[ownership_start:], start=ownership_start):
                token_start = start_token_idx if (state == states[0] and oi == ownership_start) else 0
                for ti, token in enumerate(search_tokens[token_start:], start=token_start):
                    if fixture_dir is not None:
                        payload = _load_fixture_search(fixture_dir, token)
                        pages = [(1, payload, payload.get("facilities") or [])]
                    else:
                        assert client is not None
                        pages = client.iter_search_pages(
                            ownership_code=ownership,
                            state_lgd_code=state_code,
                            facility_name=token,
                            results_per_page=results_per_page,
                            max_pages=max_pages_per_query,
                        )

                    for _page, _payload, facilities in pages:
                        for fac in facilities:
                            if hospitals_only and not is_hospital_record(fac):
                                continue
                            facility_id = fac.get("facilityId") or fac.get("facility_id")
                            if not facility_id or facility_id in by_id:
                                continue

                            if fixture_dir is not None:
                                detail = _load_fixture_detail(fixture_dir, facility_id)
                            else:
                                assert client is not None
                                detail = client.facility_detail(facility_id)

                            name = fac.get("facilityName") or fac.get("facility_name") or ""
                            rec = flatten_facility(
                                fac,
                                detail,
                                collected_at=collected_at,
                                match_name=normalize_name(name),
                                brand_key=brand_key(name),
                            )
                            partial_fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                            by_id[facility_id] = rec

                    partial_fh.flush()
                    _write_manifest(
                        manifest_path,
                        NhprSummary(
                            out_dir=str(out_dir),
                            collected_at=collected_at,
                            total=len(by_id),
                            hospitals=len(by_id),
                            with_beds=sum(1 for r in by_id.values() if r.get("total_beds")),
                            states_scanned=len(states_scanned),
                            ownership_codes=list(ownership_codes),
                            search_tokens=list(search_tokens),
                            last_state_code=state_code,
                            last_ownership=ownership,
                            last_token=token,
                            used_legacy_api=bool(client and client._use_legacy),
                        ),
                        states_scanned_list=states_scanned,
                        last_ownership_idx=oi,
                        last_token_idx=ti,
                    )

                start_token_idx = 0
            start_ownership_idx = 0

    records = sorted(
        by_id.values(),
        key=lambda r: (
            (r.get("state_name") or "~"),
            (r.get("district_name") or "~"),
            r.get("facility_name") or "",
        ),
    )
    records_path = out_dir / "nhpr_hospitals.json"
    records_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    with_beds = sum(1 for r in records if r.get("total_beds"))
    summary = NhprSummary(
        out_dir=str(out_dir),
        collected_at=collected_at,
        total=len(records),
        hospitals=len(records),
        with_beds=with_beds,
        states_scanned=len(states_scanned),
        ownership_codes=list(ownership_codes),
        search_tokens=list(search_tokens),
        records_path=str(records_path),
        used_legacy_api=bool(client and client._use_legacy),
    )
    _write_manifest(manifest_path, summary, states_scanned_list=states_scanned)
    partial_path.unlink(missing_ok=True)
    logger.success(
        "Collected {} NHPR hospital(s) ({} with bed counts) → {}",
        summary.total, with_beds, records_path,
    )
    return summary


def _write_manifest(
    path: Path,
    summary: NhprSummary,
    *,
    states_scanned_list: list[str] | None = None,
    last_ownership_idx: int | None = None,
    last_token_idx: int | None = None,
) -> None:
    payload = asdict(summary)
    if states_scanned_list is not None:
        payload["states_scanned_list"] = states_scanned_list
    if last_ownership_idx is not None:
        payload["last_ownership_idx"] = last_ownership_idx
    if last_token_idx is not None:
        payload["last_token_idx"] = last_token_idx
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument(
        "--ownership", nargs="+", default=list(DEFAULT_OWNERSHIP_CODES),
        help="Ownership codes to iterate (default: P G PP).",
    )
    parser.add_argument(
        "--search-tokens", nargs="+", default=list(DEFAULT_SEARCH_TOKENS),
        help="Facility-name search tokens (default includes 'hospital' + a-z).",
    )
    parser.add_argument("--max-states", type=int, help="Only scan this many states.")
    parser.add_argument(
        "--max-pages", type=int,
        help="Cap pages per ownership/state/token query (default: all).",
    )
    parser.add_argument("--results-per-page", type=int, default=100)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument(
        "--all-facility-types", action="store_true",
        help="Do not filter to hospital facility types.",
    )
    parser.add_argument(
        "--fixture-dir", type=Path,
        help="Offline fixture directory (tests/fixtures/nhpr) — skips network.",
    )
    args = parser.parse_args(argv)

    collect(
        out_dir=args.out,
        ownership_codes=tuple(args.ownership),
        search_tokens=tuple(args.search_tokens),
        max_states=args.max_states,
        max_pages_per_query=args.max_pages,
        results_per_page=args.results_per_page,
        resume=args.resume,
        hospitals_only=not args.all_facility_types,
        fixture_dir=args.fixture_dir,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
