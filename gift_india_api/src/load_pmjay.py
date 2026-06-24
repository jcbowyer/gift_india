"""Land PMJAY empanelled hospitals into ``bronze.facilities_pmjay``.

``src.pmjay_scraper`` scrapes the official HEM hospital search portal
(``hospitals.pmjay.gov.in``) and writes ``data/bronze_pmjay/facilities_pmjay.json``
— one record per empanelled hospital in India. This module reads that output and
loads one **bronze** row per hospital into ``bronze.facilities_pmjay`` — the raw
PMJAY REFERENCE landing table that dbt resolves to facility_ids (silver -> gold)
to flag PMJAY empanelment.

Like ``src.load_nabh`` it targets local Postgres or Databricks Lakebase, and loads
are **idempotent**: ``pmjay_org_id`` is a stable hash of the normalized name +
district + state + EHCP id, so re-loading the same set inserts nothing new
(``ON CONFLICT``), while refreshed fields are updated in place.

Examples
--------
Scrape the directory first, then land it in local Postgres::

    python -m src.pmjay_scraper
    python -m src.load_pmjay

Load into Lakebase::

    python -m src.load_pmjay --target lakebase \\
        --endpoint projects/gift_india/branches/production/endpoints/primary \\
        --profile <profile>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from loguru import logger

from . import db
from .load_db import DEFAULT_OWNER, _ensure_schema, _lakebase_dsn
from .pmjay_scraper import DEFAULT_OUT_DIR

_PMJAY_COLS = [
    "pmjay_org_id", "pmjay_name", "hecp_id", "hospital_type",
    "district", "state", "pincode", "country", "address",
    "email", "phone", "specialties", "specialties_upgraded",
    "empanelment_scheme", "nabh_status", "bed_strength",
    "lat", "lng", "pmjay_state_code", "pmjay_district_code",
    "match_name", "brand_key",
    "verified_on_portal", "source", "source_url", "data_source", "collected_at",
]


def pmjay_rows(out_dir: Path = DEFAULT_OUT_DIR) -> list[tuple]:
    """Build ``bronze.facilities_pmjay`` rows from ``facilities_pmjay.json``."""
    records_path = out_dir / "facilities_pmjay.json"
    if not records_path.exists():
        raise FileNotFoundError(
            f"No PMJAY records at {records_path}. Run `python -m src.pmjay_scraper` "
            "(or `make pmjay-scrape`) first to populate data/bronze_pmjay/."
        )
    records = json.loads(records_path.read_text(encoding="utf-8"))
    rows: list[tuple] = []
    seen: set[str] = set()
    for r in records:
        org_id = r.get("pmjay_org_id")
        if not org_id or org_id in seen:
            continue
        seen.add(org_id)
        rows.append(tuple(r.get(col) for col in _PMJAY_COLS))
    return rows


def _load(conn, schema: str, rows: list[tuple]) -> int:
    """Upsert PMJAY rows; refresh mutable fields when a row already exists."""
    if not rows:
        return 0
    cols = ", ".join(_PMJAY_COLS)
    placeholders = ", ".join(["%s"] * len(_PMJAY_COLS))
    updates = ", ".join(
        f"{c} = EXCLUDED.{c}" for c in _PMJAY_COLS if c != "pmjay_org_id"
    )
    sql = (
        f"INSERT INTO {schema}.facilities_pmjay ({cols}) "
        f"VALUES ({placeholders}) "
        f"ON CONFLICT (pmjay_org_id) DO UPDATE SET {updates}"
    )
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
        affected = cur.rowcount
    conn.commit()
    return affected if affected is not None and affected >= 0 else len(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", type=Path, default=DEFAULT_OUT_DIR,
        help=f"PMJAY scrape output directory to load (default: {DEFAULT_OUT_DIR}).",
    )
    parser.add_argument(
        "--target", choices=["local", "lakebase"], default="local",
        help="Where to load the PMJAY rows (default: local).",
    )
    parser.add_argument("--dsn", help="Explicit Postgres DSN (local target).")
    parser.add_argument(
        "--endpoint",
        help="Lakebase endpoint resource path (required for --target lakebase).",
    )
    parser.add_argument("--profile", help="Databricks CLI profile.")
    parser.add_argument(
        "--owner", default=DEFAULT_OWNER,
        help=f"Lakebase group role to log in as (default: {DEFAULT_OWNER}).",
    )
    parser.add_argument(
        "--user", help="Override the Lakebase login role (defaults to --owner)."
    )
    parser.add_argument(
        "--database", default="gift_india",
        help="Lakebase database / catalog name (default: gift_india).",
    )
    parser.add_argument("--schema", default=db.DEFAULT_SCHEMA)
    args = parser.parse_args(argv)

    rows = pmjay_rows(args.source)
    if not rows:
        logger.warning(
            "No PMJAY records found in {}. Run `make pmjay-scrape` first.", args.source
        )
        return 0

    if args.target == "lakebase":
        if not args.endpoint:
            parser.error("--endpoint is required for --target lakebase")
        dsn = _lakebase_dsn(args)
        where = f"Lakebase ({args.endpoint})"
    else:
        dsn = args.dsn or db.database_url() or db.LOCAL_DEFAULT_DSN
        where = "local Postgres"

    logger.info("Connecting to {}…", where)
    with db.connect(dsn) as conn:
        _ensure_schema(conn)
        affected = _load(conn, args.schema, rows)

    logger.success(
        "Upserted {} PMJAY hospital(s) into {}.facilities_pmjay on {}.",
        affected, args.schema, where,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
