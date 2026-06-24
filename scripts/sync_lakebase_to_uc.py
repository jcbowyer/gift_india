#!/usr/bin/env python3
"""Mirror Lakebase gold.* serving tables into workspace.gift_serving for Genie."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import psycopg2
from databricks import sql
from databricks.sdk.core import Config

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "gift_india_api"))

from src import db  # noqa: E402

PROFILE = "gift-india-mb"
WAREHOUSE_ID = "234ccf680e359443"
ENDPOINT = "projects/gift-india/branches/production/endpoints/primary"
UC_SCHEMA = "workspace.gift_serving"
BATCH_SIZE = 200

TABLES = (
    "facilities",
    "facility_capability_assessments",
    "capability_scored",
    "geography",
)

PG_TYPE_TO_SQL = {
    "text": "STRING",
    "character varying": "STRING",
    "varchar": "STRING",
    "boolean": "BOOLEAN",
    "integer": "INT",
    "bigint": "BIGINT",
    "double precision": "DOUBLE",
    "numeric": "DOUBLE",
    "jsonb": "STRING",
    "timestamp with time zone": "TIMESTAMP",
    "timestamp without time zone": "TIMESTAMP",
}


def lakebase_conn():
    creds = db.lakebase_credentials(ENDPOINT, PROFILE)
    return psycopg2.connect(
        host=creds["host"],
        port=5432,
        user="jbowyer@carequest.org",
        password=creds["token"],
        dbname="gift_india",
        sslmode="require",
    )


def uc_conn():
    cfg = Config(profile=PROFILE)
    host = cfg.host.replace("https://", "").replace("http://", "")
    headers = cfg.authenticate()
    return sql.connect(
        server_hostname=host,
        http_path=f"/sql/1.0/warehouses/{WAREHOUSE_ID}",
        access_token=headers["Authorization"].removeprefix("Bearer "),
    )


def pg_columns(cur, table: str) -> list[tuple[str, str]]:
    cur.execute(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'gold' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table,),
    )
    return cur.fetchall()


def ddl_for(table: str, columns: list[tuple[str, str]]) -> str:
    parts = [f"`{name}` {PG_TYPE_TO_SQL.get(pg_type, 'STRING')}" for name, pg_type in columns]
    return f"CREATE OR REPLACE TABLE {UC_SCHEMA}.{table} (\n  {', '.join(parts)}\n) USING DELTA"


def sql_value(v, pg_type: str) -> str:
    if v is None:
        return "NULL"
    if pg_type == "boolean":
        return "true" if v else "false"
    if pg_type in ("integer", "bigint", "double precision", "numeric"):
        return str(v)
    if isinstance(v, (dict, list)):
        v = json.dumps(v)
    else:
        v = str(v)
    return "'" + v.replace("\\", "\\\\").replace("'", "''") + "'"


def insert_batch(uc_cur, table: str, columns: list[tuple[str, str]], rows: list[tuple]) -> None:
    if not rows:
        return
    col_sql = ", ".join(f"`{name}`" for name, _ in columns)
    values_sql = []
    for row in rows:
        vals = ", ".join(sql_value(v, pg_type) for v, (_, pg_type) in zip(row, columns))
        values_sql.append(f"({vals})")
    uc_cur.execute(
        f"INSERT INTO {UC_SCHEMA}.{table} ({col_sql}) VALUES {', '.join(values_sql)}"
    )


def main() -> int:
    only = {t.strip() for t in sys.argv[1:] if t.strip()}

    with uc_conn() as uc:
        uc_cur = uc.cursor()
        uc_cur.execute(f"CREATE SCHEMA IF NOT EXISTS {UC_SCHEMA}")

        for table in TABLES:
            if only and table not in only:
                continue
            print(f"syncing {table}...", flush=True)
            pg = lakebase_conn()
            pg_cur = pg.cursor()
            pg_cur.execute(f"SELECT COUNT(*) FROM gold.{table}")
            count = pg_cur.fetchone()[0]
            if count == 0:
                print(f"skip {table}: empty or missing")
                pg.close()
                continue

            columns = pg_columns(pg_cur, table)
            col_names = [c[0] for c in columns]
            uc_cur.execute(f"DROP TABLE IF EXISTS {UC_SCHEMA}.{table}")
            uc_cur.execute(ddl_for(table, columns))

            pg_cur.execute(f"SELECT {', '.join(col_names)} FROM gold.{table}")
            written = 0
            while True:
                rows = pg_cur.fetchmany(BATCH_SIZE)
                if not rows:
                    break
                insert_batch(uc_cur, table, columns, rows)
                written += len(rows)
                if written % 2000 == 0:
                    print(f"  {table}: {written}/{count}", flush=True)

            print(f"synced {table}: {written} rows")
            pg.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
