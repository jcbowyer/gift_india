"""Create the schema and load the gift_india dataset into Postgres.

The same loader targets local Postgres or Databricks Lakebase — develop fast
locally, then publish the identical data to Lakebase for the deployed app.

Examples
--------
Local dev (uses ``GIFT_INDIA_DB_URL`` / ``.env`` / the docker-compose default)::

    python -m src.load_db

Publish to Lakebase (resolves host + OAuth token via the Databricks CLI)::

    python -m src.load_db --target lakebase \\
        --endpoint projects/gift_india/branches/production/endpoints/<endpoint_id> \\
        --profile <profile>
"""
from __future__ import annotations

import argparse
import math
import os
from pathlib import Path
from urllib.parse import quote

import numpy as np

from . import db
from .data import build_dataset

_SCHEMA_SQL = Path(__file__).resolve().parent.parent / "db" / "schema.sql"

_DISTRICT_COLS = ["district", "state", "lat", "lon", "population", "urbanity"]
_FACILITY_COLS = [
    "facility_id", "name", "type", "district", "state", "lat", "lon",
    "beds", "annual_surgeries", "offers_surgery", "specialties",
    "website_url", "match_confidence",
]


def _ensure_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(_SCHEMA_SQL.read_text())
    conn.commit()


def _native(value):
    """Convert numpy scalars / NaN to plain Python types psycopg can adapt."""
    if isinstance(value, np.generic):
        value = value.item()
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return value


def _copy(cur, table: str, columns: list[str], frame) -> None:
    cols = ", ".join(columns)
    with cur.copy(f"COPY {table} ({cols}) FROM STDIN") as copy:
        for row in frame[columns].itertuples(index=False, name=None):
            copy.write_row(tuple(_native(v) for v in row))


def _load(conn, schema: str, force: bool) -> tuple[int, int]:
    bundle = build_dataset(force=force)
    districts = bundle.districts
    facilities = bundle.facilities.copy()
    facilities["specialties"] = facilities["specialties"].fillna("")
    if "website_url" not in facilities.columns:
        facilities["website_url"] = ""
    facilities["website_url"] = facilities["website_url"].fillna("")

    with conn.cursor() as cur:
        cur.execute(
            f"TRUNCATE {schema}.facilities, {schema}.districts "
            "RESTART IDENTITY CASCADE"
        )
        _copy(cur, f"{schema}.districts", _DISTRICT_COLS, districts)
        _copy(cur, f"{schema}.facilities", _FACILITY_COLS, facilities)
    conn.commit()
    return len(districts), len(facilities)


def _lakebase_dsn(args) -> str:
    creds = db.lakebase_credentials(args.endpoint, args.profile)
    user = args.user or os.getenv("PGUSER") or db.current_user(args.profile)
    return (
        f"postgresql://{quote(user)}:{quote(creds['token'])}@"
        f"{creds['host']}:5432/{args.database}?sslmode=require"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target", choices=["local", "lakebase"], default="local",
        help="Where to load the data (default: local).",
    )
    parser.add_argument("--dsn", help="Explicit Postgres DSN (local target).")
    parser.add_argument(
        "--endpoint",
        help="Lakebase endpoint resource path (required for --target lakebase).",
    )
    parser.add_argument("--profile", help="Databricks CLI profile.")
    parser.add_argument("--user", help="Postgres role (defaults to Databricks user).")
    parser.add_argument(
        "--database", default="databricks_postgres",
        help="Lakebase database name (default: databricks_postgres).",
    )
    parser.add_argument("--schema", default=db.DEFAULT_SCHEMA)
    parser.add_argument(
        "--force", action="store_true",
        help="Regenerate the synthetic dataset before loading.",
    )
    args = parser.parse_args(argv)

    if args.target == "lakebase":
        if not args.endpoint:
            parser.error("--endpoint is required for --target lakebase")
        dsn = _lakebase_dsn(args)
        where = f"Lakebase ({args.endpoint})"
    else:
        dsn = args.dsn or db.database_url() or db.LOCAL_DEFAULT_DSN
        where = "local Postgres"

    print(f"Connecting to {where}…")
    with db.connect(dsn) as conn:
        _ensure_schema(conn)
        n_districts, n_facilities = _load(conn, args.schema, args.force)

    print(
        f"Loaded {n_districts:,} districts and {n_facilities:,} facilities "
        f"into {args.schema}.* on {where}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
