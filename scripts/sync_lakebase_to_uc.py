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

TABLES = (
    "facilities",
    "facility_capability_assessments",
    "capability_evidence",
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
    parts = []
    for name, pg_type in columns:
        sql_type = PG_TYPE_TO_SQL.get(pg_type, "STRING")
        parts.append(f"`{name}` {sql_type}")
    cols = ",\n  ".join(parts)
    return f"CREATE OR REPLACE TABLE {UC_SCHEMA}.{table} (\n  {cols}\n) USING DELTA"


def main() -> int:
    pg = lakebase_conn()
    pg_cur = pg.cursor()

    with uc_conn() as uc:
        uc_cur = uc.cursor()
        uc_cur.execute(f"CREATE SCHEMA IF NOT EXISTS {UC_SCHEMA}")

        for table in TABLES:
            pg_cur.execute(f"SELECT COUNT(*) FROM gold.{table}")
            count = pg_cur.fetchone()[0]
            if count == 0:
                print(f"skip {table}: empty or missing")
                continue

            columns = pg_columns(pg_cur, table)
            if not columns:
                print(f"skip {table}: no columns")
                continue

            col_names = [c[0] for c in columns]
            uc_cur.execute(f"DROP TABLE IF EXISTS {UC_SCHEMA}.{table}")
            uc_cur.execute(ddl_for(table, columns))

            select_cols = ", ".join(col_names)
            pg_cur.execute(f"SELECT {select_cols} FROM gold.{table}")
            placeholders = ", ".join(["?"] * len(col_names))
            insert_sql = (
                f"INSERT INTO {UC_SCHEMA}.{table} ({', '.join(f'`{c}`' for c in col_names)}) "
                f"VALUES ({placeholders})"
            )

            batch: list[tuple] = []
            written = 0
            string_cols = {
                i for i, (_, pg_type) in enumerate(columns) if pg_type in ("text", "character varying", "varchar", "jsonb")
            }

            def normalize(row: tuple) -> tuple:
                out = []
                for i, v in enumerate(row):
                    if v is None:
                        out.append(None)
                    elif isinstance(v, (dict, list)):
                        out.append(json.dumps(v))
                    elif i in string_cols:
                        out.append(str(v))
                    else:
                        out.append(v)
                return tuple(out)

            while True:
                rows = pg_cur.fetchmany(500)
                if not rows:
                    break
                for row in rows:
                    batch.append(normalize(row))
                    if len(batch) >= 500:
                        uc_cur.executemany(insert_sql, batch)
                        written += len(batch)
                        batch = []
            if batch:
                uc_cur.executemany(insert_sql, batch)
                written += len(batch)

            print(f"synced {table}: {written} rows")

    pg.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
