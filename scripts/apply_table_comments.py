#!/usr/bin/env python3
"""Apply Postgres COMMENT ON metadata for bronze, app, and non-dbt gold tables.

dbt persist_docs (see gift_india_dbt/dbt_project.yml) handles silver/gold dbt
models and seeds. This script applies the remaining comments from
db/table_comments.sql so Genie has descriptions on every table locally and on
Lakebase.

Usage:
    python scripts/apply_table_comments.py
    python scripts/apply_table_comments.py --target lakebase \\
        --endpoint projects/gift_india/branches/production/endpoints/primary \\
        --profile gift-india-mb
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "gift_india_api"))

from urllib.parse import quote

from src import db  # noqa: E402
from src.pg_env import load_env_files, sync_from_url  # noqa: E402

_COMMENTS_SQL = REPO / "db" / "table_comments.sql"


def _local_dsn() -> str:
    load_env_files()
    sync_from_url()
    if url := os.environ.get("GIFT_INDIA_DB_URL", "").strip():
        return url
    host = os.environ.get("GIFT_INDIA_PGHOST", "localhost")
    port = os.environ.get("GIFT_INDIA_PGPORT", "5433")
    user = os.environ.get("GIFT_INDIA_PGUSER", "postgres")
    pwd = os.environ.get("GIFT_INDIA_PGPASSWORD", "")
    database = os.environ.get("GIFT_INDIA_PGDATABASE", "gift_india")
    sslmode = os.environ.get("GIFT_INDIA_PGSSLMODE", "prefer")
    auth = f"{quote(user)}:{quote(pwd)}@" if user else ""
    return f"postgresql://{auth}{host}:{port}/{database}?sslmode={sslmode}"


def _lakebase_dsn(endpoint: str, profile: str | None, owner: str | None) -> str:
    creds = db.lakebase_credentials(endpoint, profile)
    user = quote(owner or db.current_user(profile))
    return (
        f"postgresql://{user}:{quote(creds['token'])}@"
        f"{creds['host']}:5432/gift_india?sslmode=require"
    )


def _apply_sql(conn, sql: str) -> None:
    """Run COMMENT statements; skip objects that do not exist yet."""
    pending = []
    for line in sql.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        pending.append(line)
        if stripped.endswith(";"):
            stmt = "\n".join(pending).strip()
            pending = []
            with conn.cursor() as cur:
                try:
                    cur.execute(stmt)
                except psycopg.errors.UndefinedTable:
                    conn.rollback()
                    print(f"skip (table missing): {stmt.split(chr(10), 1)[0][:80]}…")
                except psycopg.errors.UndefinedColumn:
                    conn.rollback()
                    print(f"skip (column missing): {stmt.split(chr(10), 1)[0][:80]}…")
                except psycopg.errors.InvalidSchemaName:
                    conn.rollback()
                    print(f"skip (schema missing): {stmt.split(chr(10), 1)[0][:80]}…")
                except psycopg.errors.InsufficientPrivilege:
                    conn.rollback()
                    print(f"skip (no privilege): {stmt.split(chr(10), 1)[0][:80]}…")
                else:
                    conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        choices=("local", "lakebase"),
        default="local",
        help="Postgres target (default: local from GIFT_INDIA_DB_URL / .env)",
    )
    parser.add_argument("--endpoint", help="Lakebase endpoint path (required for --target lakebase)")
    parser.add_argument("--profile", help="Databricks CLI profile for Lakebase auth")
    parser.add_argument(
        "--user",
        help="Lakebase login role (defaults to authenticated Databricks user)",
    )
    args = parser.parse_args()

    if not _COMMENTS_SQL.is_file():
        print(f"ERROR: missing {_COMMENTS_SQL}", file=sys.stderr)
        return 1

    sql = _COMMENTS_SQL.read_text()
    if args.target == "lakebase":
        if not args.endpoint:
            print("ERROR: --endpoint is required for --target lakebase", file=sys.stderr)
            return 1
        conn = db.connect(_lakebase_dsn(args.endpoint, args.profile, args.user))
    else:
        conn = db.connect(_local_dsn())

    _apply_sql(conn, sql)
    conn.close()
    print(f"Applied table/column comments from {_COMMENTS_SQL.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
