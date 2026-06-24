"""Land NHPR hospital scrape output into ``bronze.locations_nhpr``.

``src.nhpr_scraper`` writes ``data/nhpr/nhpr_hospitals.json`` — one record per
registered hospital in the HFR/NHPR directory, including bed-capacity fields from
the ``facilityDetail`` API. This module upserts those rows into bronze for dbt
entity resolution downstream.

Examples
--------
Scrape first, then land in local Postgres::

    python -m src.nhpr_scraper
    python -m src.load_nhpr

Load into Lakebase::

    python -m src.load_nhpr --target lakebase \\
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
from .nhpr_scraper import DEFAULT_OUT_DIR

_COLS = [
    "nhpr_facility_id", "facility_name", "facility_status",
    "facility_type", "facility_type_code", "ownership", "ownership_code",
    "system_of_medicine", "system_of_medicine_code",
    "state_name", "state_lgd_code", "district_name", "district_lgd_code",
    "sub_district_name", "sub_district_lgd_code", "village_city_town_name",
    "address", "pincode", "latitude", "longitude",
    "website_url", "phone", "email",
    "total_beds", "ipd_beds_with_oxygen", "ipd_beds_without_oxygen",
    "icu_beds_with_ventilators", "icu_beds_without_ventilators",
    "hdu_beds_with_ventilators", "hdu_beds_without_ventilators",
    "hdu_beds_with_functional_ventilators",
    "day_care_beds_with_oxygen", "day_care_beds_without_oxygen",
    "dental_chairs", "total_ventilators",
    "specialities", "imaging_services", "diagnostic_services",
    "match_name", "brand_key",
    "detail_json", "search_json",
    "verified_on_portal", "source", "source_url", "data_source", "collected_at",
]


def nhpr_rows(out_dir: Path = DEFAULT_OUT_DIR) -> list[tuple]:
    """Build ``bronze.locations_nhpr`` rows from ``nhpr_hospitals.json``."""
    records_path = out_dir / "nhpr_hospitals.json"
    if not records_path.exists():
        raise FileNotFoundError(
            f"No NHPR records at {records_path}. Run `python -m src.nhpr_scraper` "
            "(or `make nhpr-scrape`) first to populate data/nhpr/."
        )
    records = json.loads(records_path.read_text(encoding="utf-8"))
    rows: list[tuple] = []
    seen: set[str] = set()
    for r in records:
        fid = r.get("nhpr_facility_id")
        if not fid or fid in seen:
            continue
        seen.add(fid)
        row = []
        for col in _COLS:
            val = r.get(col)
            row.append(val)
        rows.append(tuple(row))
    return rows


def _load(conn, schema: str, rows: list[tuple]) -> int:
    if not rows:
        return 0
    cols = ", ".join(_COLS)
    placeholders = ", ".join(["%s"] * len(_COLS))
    updates = ", ".join(
        f"{c} = EXCLUDED.{c}" for c in _COLS if c != "nhpr_facility_id"
    )
    sql = (
        f"INSERT INTO {schema}.locations_nhpr ({cols}) "
        f"VALUES ({placeholders}) "
        f"ON CONFLICT (nhpr_facility_id) DO UPDATE SET {updates}"
    )
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
        affected = cur.rowcount
    conn.commit()
    return affected if affected is not None and affected >= 0 else len(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--target", choices=["local", "lakebase"], default="local")
    parser.add_argument("--dsn", help="Explicit Postgres DSN (local target).")
    parser.add_argument("--endpoint", help="Lakebase endpoint (required for lakebase).")
    parser.add_argument("--profile", help="Databricks CLI profile.")
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--user", help="Override Lakebase login role.")
    parser.add_argument("--database", default="gift_india")
    parser.add_argument("--schema", default=db.DEFAULT_SCHEMA)
    args = parser.parse_args(argv)

    rows = nhpr_rows(args.source)
    if not rows:
        logger.warning("No NHPR records found in {}. Run `make nhpr-scrape` first.", args.source)
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
        "Upserted {} NHPR hospital(s) into {}.locations_nhpr on {}.",
        affected, args.schema, where,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
