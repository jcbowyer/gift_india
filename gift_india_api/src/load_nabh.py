"""Land the NABH accredited-organizations directory into ``bronze.facilities_nabh``.

``src.nabh_scraper`` scrapes the official NABH directory (``nabh.co``) and writes
``data/nabh/nabh_accredited.json`` — one record per accredited / certified /
empanelled facility in India. This module reads that output and loads one **bronze**
row per organization into ``bronze.facilities_nabh`` — the raw accreditation
REFERENCE landing table that dbt resolves to facility_ids (silver -> gold) to flag
``nabh_accredited``.

Like ``src.load_jci`` it targets local Postgres or Databricks Lakebase, and loads are
**idempotent**: ``nabh_org_id`` is a stable hash of the normalized name + city + state
+ reference number, so re-loading the same set inserts nothing new (``ON CONFLICT``),
while refreshed fields (a new status, a fixed geocode) are updated in place.

Examples
--------
Scrape the directory first, then land it in local Postgres::

    python -m src.nabh_scraper
    python -m src.load_nabh

Load into Lakebase::

    python -m src.load_nabh --target lakebase \\
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
from .nabh_scraper import DEFAULT_OUT_DIR

_NABH_COLS = [
    "nabh_org_id", "nabh_name", "city", "state", "pincode", "country",
    "accreditation_program", "accreditation_status", "reference_no",
    "certificate_url", "address", "match_name", "brand_key",
    "website_url", "phone", "lat", "lng",
    "verified_on_portal", "source", "source_url", "data_source", "collected_at",
]


def nabh_rows(out_dir: Path = DEFAULT_OUT_DIR) -> list[tuple]:
    """Build ``bronze.facilities_nabh`` rows from ``nabh_accredited.json``."""
    records_path = out_dir / "nabh_accredited.json"
    if not records_path.exists():
        raise FileNotFoundError(
            f"No NABH records at {records_path}. Run `python -m src.nabh_scraper` "
            "(or `make nabh-scrape`) first to populate data/nabh/."
        )
    records = json.loads(records_path.read_text(encoding="utf-8"))
    rows: list[tuple] = []
    seen: set[str] = set()
    for r in records:
        org_id = r.get("nabh_org_id")
        if not org_id or org_id in seen:  # defend against a duplicated record
            continue
        seen.add(org_id)
        rows.append(tuple(r.get(col) for col in _NABH_COLS))
    return rows


def _load(conn, schema: str, rows: list[tuple]) -> int:
    """Upsert NABH rows; refresh mutable fields when a row already exists."""
    if not rows:
        return 0
    cols = ", ".join(_NABH_COLS)
    placeholders = ", ".join(["%s"] * len(_NABH_COLS))
    updates = ", ".join(
        f"{c} = EXCLUDED.{c}" for c in _NABH_COLS if c != "nabh_org_id"
    )
    sql = (
        f"INSERT INTO {schema}.facilities_nabh ({cols}) "
        f"VALUES ({placeholders}) "
        f"ON CONFLICT (nabh_org_id) DO UPDATE SET {updates}"
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
        help=f"NABH scrape output directory to load (default: {DEFAULT_OUT_DIR}).",
    )
    parser.add_argument(
        "--target", choices=["local", "lakebase"], default="local",
        help="Where to load the NABH rows (default: local).",
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

    rows = nabh_rows(args.source)
    if not rows:
        logger.warning(
            "No NABH records found in {}. Run `make nabh-scrape` first.", args.source
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
        "Upserted {} NABH org(s) into {}.facilities_nabh on {}.",
        affected, args.schema, where,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
