"""Land Model ABDM facility scrape output into ``bronze.facilities_abdm``.

``src.abdm_scraper`` scrapes the ABDM Insights dashboard
(``dashboardbeta.abdm.gov.in/abdm/model-abdm``) and writes
``data/abdm/facilities_abdm.json`` — one record per end-to-end ABDM adoption
pilot facility. This module upserts those rows into bronze for dbt entity
resolution downstream.

Examples
--------
Scrape first, then land in local Postgres::

    python -m src.abdm_scraper
    python -m src.load_abdm

Load into Lakebase::

    python -m src.load_abdm --target lakebase \\
        --endpoint projects/gift_india/branches/production/endpoints/primary \\
        --profile <profile>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from loguru import logger

from psycopg.types.json import Json

from . import db
from .abdm_scraper import DEFAULT_OUT_DIR
from .load_db import DEFAULT_OWNER, _ensure_schema, _lakebase_dsn

_COLS = [
    "abdm_facility_id", "facility_name", "hfr_id", "facility_type",
    "state", "district", "partner_name", "initiative_status",
    "declared_doctors", "declared_nurses", "declared_hpr_total",
    "verified_doctors", "verified_nurses", "verified_hpr_total",
    "hrl_linked_count", "is_model_abdm_facility",
    "hpr_json", "hrl_json", "nhpr_json",
    "match_name", "brand_key",
    "verified_on_portal", "source", "source_url", "data_source", "collected_at",
]


_JSON_COLS = frozenset({"hpr_json", "hrl_json", "nhpr_json"})


def abdm_rows(out_dir: Path = DEFAULT_OUT_DIR) -> list[tuple]:
    """Build ``bronze.facilities_abdm`` rows from ``facilities_abdm.json``."""
    records_path = out_dir / "facilities_abdm.json"
    if not records_path.exists():
        raise FileNotFoundError(
            f"No ABDM records at {records_path}. Run `python -m src.abdm_scraper` "
            "(or `make abdm-scrape`) first to populate data/abdm/."
        )
    records = json.loads(records_path.read_text(encoding="utf-8"))
    rows: list[tuple] = []
    seen: set[str] = set()
    for r in records:
        fid = r.get("abdm_facility_id")
        if not fid or fid in seen:
            continue
        seen.add(fid)
        row = []
        for col in _COLS:
            val = r.get(col)
            if col in _JSON_COLS and val is not None:
                val = Json(val)
            row.append(val)
        rows.append(tuple(row))
    return rows


def _load(conn, schema: str, rows: list[tuple]) -> int:
    if not rows:
        return 0
    cols = ", ".join(_COLS)
    placeholders = ", ".join(["%s"] * len(_COLS))
    updates = ", ".join(
        f"{c} = EXCLUDED.{c}" for c in _COLS if c != "abdm_facility_id"
    )
    sql = (
        f"INSERT INTO {schema}.facilities_abdm ({cols}) "
        f"VALUES ({placeholders}) "
        f"ON CONFLICT (abdm_facility_id) DO UPDATE SET {updates}"
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

    rows = abdm_rows(args.source)
    if not rows:
        logger.warning("No ABDM records found in {}. Run `make abdm-scrape` first.", args.source)
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
        "Upserted {} ABDM facility row(s) into {}.facilities_abdm on {}.",
        affected, args.schema, where,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
