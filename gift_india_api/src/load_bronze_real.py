"""Land the REAL governed Virtue Foundation rows into the Postgres ``bronze.*``
landing schema (``districts`` + ``facilities``) so the dbt medallion runs on real
data instead of the synthetic ``src.data`` demo set.

Background — there are two ways real VF data reaches Postgres:

* ``src.load_gold_real`` copies the exported gold CSVs straight into ``gold.*``
  (fast path; bypasses bronze + dbt). Good for serving, but the bronze -> silver
  -> gold medallion (and anything that joins against ``silver_facilities``, e.g.
  the JCI entity-resolution crosswalk) then has only the SYNTHETIC bronze to work
  with — so JCI matches nothing.
* THIS module lands the same real rows in ``bronze.facilities`` /
  ``bronze.districts`` (the dbt sources), so ``make dbt`` rebuilds silver + gold
  AND ``gold.facility_jci`` / ``jci_accredited`` from real names.

Source: ``data/gold_real/{facilities,geography}.csv`` (produced by
``data/export_gold_real.py`` from the Databricks Delta Share). Re-export those
first if you need fresher data. Targets local Postgres or Lakebase, same flags as
``src.load_db``::

    python data/export_gold_real.py        # (optional) refresh the CSVs from Databricks
    python -m src.load_bronze_real         # local
    make dbt                               # build silver/gold + JCI on real data
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

from loguru import logger

from . import db
from .load_db import DEFAULT_OWNER, _DISTRICT_COLS, _FACILITY_COLS, _ensure_schema, _lakebase_dsn

CSV_DIR = Path(__file__).resolve().parents[2] / "data" / "gold_real"

# Databricks CSV export writes SQL NULL as the literal token `null`.
_NULL_TOKENS = {"", "null", "none", "nan"}


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.replace("\x00", "").strip()  # Postgres text rejects NUL bytes
    return None if value.lower() in _NULL_TOKENS else value


def _num(value: str | None, default=None):
    v = _clean(value)
    return default if v is None else v


def district_rows(csv_dir: Path) -> list[tuple]:
    """Map ``geography.csv`` -> ``bronze.districts`` rows (one per district)."""
    path = csv_dir / "geography.csv"
    rows: list[tuple] = []
    seen: set[tuple] = set()
    with path.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            district, state = _clean(r.get("district")), _clean(r.get("state"))
            lat, lon = _num(r.get("lat")), _num(r.get("lon"))
            # bronze.districts requires coords; skip rows without them (facilities
            # in these districts are then skipped too via the FK check).
            if not district or not state or lat is None or lon is None:
                continue
            if (district, state) in seen:
                continue
            seen.add((district, state))
            # _DISTRICT_COLS: district, state, lat, lon, population, urbanity
            rows.append((
                district,
                state,
                lat,
                lon,
                _num(r.get("population"), 0),
                _num(r.get("urbanity"), 0),
            ))
    return rows


def facility_rows(csv_dir: Path, valid_districts: set[tuple]) -> tuple[list[tuple], int]:
    """Map ``facilities.csv`` -> ``bronze.facilities`` rows, honoring the FK.

    Facilities whose (district, state) is absent from ``bronze.districts`` or whose
    coordinates are missing are skipped (and counted) so the load respects the
    schema's NOT NULL / foreign-key constraints.
    """
    path = csv_dir / "facilities.csv"
    rows: list[tuple] = []
    seen: set[str] = set()
    skipped = 0
    with path.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            fid = _clean(r.get("facility_id"))
            district, state = _clean(r.get("district")), _clean(r.get("state"))
            lat, lon = _num(r.get("lat")), _num(r.get("lon"))
            if not fid or fid in seen or lat is None or lon is None:
                skipped += 1
                continue
            if (district, state) not in valid_districts:
                skipped += 1
                continue
            seen.add(fid)
            # _FACILITY_COLS: facility_id, name, type, district, state, lat, lon,
            # beds, annual_surgeries, offers_surgery, specialties, website_url,
            # match_confidence
            rows.append((
                fid,
                _clean(r.get("name")) or fid,
                _clean(r.get("type")) or "Unknown",
                district,
                state,
                lat,
                lon,
                _num(r.get("beds"), 0),
                _num(r.get("annual_surgeries"), 0),
                (_clean(r.get("offers_surgery")) or "false").lower() in {"true", "t", "1"},
                _clean(r.get("specialties")) or "",
                _clean(r.get("website_url")),
                _num(r.get("match_confidence"), 1.0),
            ))
    return rows, skipped


def _copy(cur, table: str, columns: list[str], rows: list[tuple]) -> None:
    cols = ", ".join(columns)
    with cur.copy(f"COPY {table} ({cols}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row(row)


def _load(conn, schema: str, csv_dir: Path) -> tuple[int, int, int]:
    districts = district_rows(csv_dir)
    valid = {(d[0], d[1]) for d in districts}
    facilities, skipped = facility_rows(csv_dir, valid)
    with conn.cursor() as cur:
        cur.execute(
            f"TRUNCATE {schema}.facilities, {schema}.districts RESTART IDENTITY CASCADE"
        )
        _copy(cur, f"{schema}.districts", _DISTRICT_COLS, districts)
        _copy(cur, f"{schema}.facilities", _FACILITY_COLS, facilities)
    conn.commit()
    return len(districts), len(facilities), skipped


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["local", "lakebase"], default="local")
    parser.add_argument("--dsn", help="Explicit Postgres DSN (local target).")
    parser.add_argument("--endpoint", help="Lakebase endpoint resource path.")
    parser.add_argument("--profile", help="Databricks CLI profile.")
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--user", help="Override Lakebase login role (default --owner).")
    parser.add_argument("--database", default="gift_india")
    parser.add_argument("--schema", default=db.DEFAULT_SCHEMA)
    parser.add_argument("--csv-dir", default=str(CSV_DIR))
    args = parser.parse_args(argv)

    csv_dir = Path(args.csv_dir)
    missing = [f for f in ("geography.csv", "facilities.csv") if not (csv_dir / f).exists()]
    if missing:
        parser.error(
            f"missing CSV(s) in {csv_dir}: {missing}. "
            "Run `python data/export_gold_real.py` first."
        )

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
        n_districts, n_facilities, skipped = _load(conn, args.schema, csv_dir)

    logger.success(
        "Landed {} districts and {} REAL facilities into {}.* on {} "
        "({} facility row(s) skipped: missing coords / unknown district).",
        n_districts, n_facilities, args.schema, where, skipped,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
