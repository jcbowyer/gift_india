"""Create the schema and load the gift_india dataset into Postgres.

The same loader targets local Postgres or Databricks Lakebase — develop fast
locally, then publish the identical data to Lakebase for the deployed app.

Examples
--------
Local dev (uses ``GIFT_INDIA_DB_URL`` / ``.env`` / the docker-compose default)::

    python -m src.load_db

Publish to Lakebase (resolves host + OAuth token via the Databricks CLI). The
loader logs in as the shared ``admins`` group role so the ``gift_india`` catalog,
its schema, and tables are all owned by ``admins``::

    python -m src.load_db --target lakebase \\
        --endpoint projects/gift_india/branches/production/endpoints/primary \\
        --profile <profile>
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path
from urllib.parse import quote

import numpy as np

from . import db
from .data import build_dataset

_SCHEMA_SQL = Path(__file__).resolve().parents[2] / "db" / "schema.sql"

# Postgres role that should own the `gift_india` catalog, its schema, and every
# table. On Lakebase this is the shared `admins` group role: the loader logs in
# AS the group (any group member authenticates with the group role name as the
# username and their own OAuth token), so everything it creates is owned by
# `admins` directly — no ownership transfer needed. See the Lakebase docs on
# Postgres group roles / object ownership.
DEFAULT_OWNER = "admins"

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


def _schema_owner(conn, schema: str) -> str | None:
    """Return the role that owns ``schema`` (or ``None`` if it does not exist)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = %s",
            (schema,),
        )
        row = cur.fetchone()
    return row[0] if row else None


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
    # Log in AS the owner group role so created objects are owned by it. Any
    # member of the Databricks group authenticates with the group role name and
    # their own short-lived OAuth token.
    user = args.user or args.owner
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
    parser.add_argument(
        "--owner", default=DEFAULT_OWNER,
        help="Lakebase group role to own the catalog/schema/tables; the loader "
             f"logs in as it (default: {DEFAULT_OWNER}).",
    )
    parser.add_argument(
        "--user",
        help="Override the Lakebase login role (defaults to --owner).",
    )
    parser.add_argument(
        "--database", default="gift_india",
        help="Lakebase database / catalog name (default: gift_india).",
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
        owner = _schema_owner(conn, args.schema)

    print(
        f"Loaded {n_districts:,} districts and {n_facilities:,} facilities "
        f"into {args.schema}.* on {where}."
    )
    print(f"Schema {args.schema} and its tables are owned by {owner!r}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
