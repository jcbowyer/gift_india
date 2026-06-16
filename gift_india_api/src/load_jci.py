"""Land the JCI-accredited-organizations seed into ``bronze.jci_accreditations``.

``src.jci_scraper`` compiles India's JCI-accredited hospitals (curated aggregator
seed + best-effort official portal) and writes ``data/jci/jci_accredited.json``.
This module reads that output and loads one **bronze** row per organization into
``bronze.jci_accreditations`` — the raw accreditation REFERENCE landing table that
dbt resolves to facility_ids (silver -> gold) to flag ``jci_accredited``.

Like ``src.load_crawl`` it targets local Postgres or Databricks Lakebase, and
loads are **idempotent**: ``jci_org_id`` is a stable hash of the normalized name +
city + state, so re-loading the same set inserts nothing new (``ON CONFLICT``),
while refreshed fields (e.g. a now-verified row) are updated in place.

Examples
--------
Build the seed first, then land it in local Postgres::

    python -m src.jci_scraper
    python -m src.load_jci

Load into Lakebase::

    python -m src.load_jci --target lakebase \\
        --endpoint projects/gift_india/branches/production/endpoints/primary \\
        --profile <profile>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from loguru import logger

from . import db
from .jci_scraper import DEFAULT_OUT_DIR
from .load_db import DEFAULT_OWNER, _ensure_schema, _lakebase_dsn

_JCI_COLS = [
    "jci_org_id", "jci_name", "city", "state", "country",
    "accreditation_program", "match_name", "brand_key",
    "website_url", "snapshot_dir",
    "verified_on_portal", "source", "source_url", "data_source", "collected_at",
]


def jci_rows(out_dir: Path = DEFAULT_OUT_DIR) -> list[tuple]:
    """Build ``bronze.jci_accreditations`` rows from ``jci_accredited.json``."""
    records_path = out_dir / "jci_accredited.json"
    if not records_path.exists():
        raise FileNotFoundError(
            f"No JCI records at {records_path}. Run `python -m src.jci_scraper` "
            "(or `make jci-scrape`) first to populate data/jci/."
        )
    records = json.loads(records_path.read_text(encoding="utf-8"))
    rows: list[tuple] = []
    seen: set[str] = set()
    for r in records:
        org_id = r.get("jci_org_id")
        if not org_id or org_id in seen:  # defend against a duplicated record
            continue
        seen.add(org_id)
        rows.append(tuple(r.get(col) for col in _JCI_COLS))
    return rows


def _load(conn, schema: str, rows: list[tuple]) -> int:
    """Upsert JCI rows; refresh mutable fields when a row already exists."""
    if not rows:
        return 0
    cols = ", ".join(_JCI_COLS)
    placeholders = ", ".join(["%s"] * len(_JCI_COLS))
    updates = ", ".join(
        f"{c} = EXCLUDED.{c}" for c in _JCI_COLS if c != "jci_org_id"
    )
    sql = (
        f"INSERT INTO {schema}.jci_accreditations ({cols}) "
        f"VALUES ({placeholders}) "
        f"ON CONFLICT (jci_org_id) DO UPDATE SET {updates}"
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
        help=f"JCI scrape output directory to load (default: {DEFAULT_OUT_DIR}).",
    )
    parser.add_argument(
        "--target", choices=["local", "lakebase"], default="local",
        help="Where to load the JCI rows (default: local).",
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

    rows = jci_rows(args.source)
    if not rows:
        logger.warning(
            "No JCI records found in {}. Run `make jci-scrape` first.", args.source
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
        "Upserted {} JCI org(s) into {}.jci_accreditations on {}.",
        affected, args.schema, where,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
