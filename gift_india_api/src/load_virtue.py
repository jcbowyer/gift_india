"""Load the REAL governed Virtue Foundation gold tables (exported to
``data/virtue/*.csv`` by ``data/export_virtue.py``) straight into the
``gold.*`` serving schema the web app reads.

This is the fast path to put 100% real, governed VF data in front of the app
without a bronze -> dbt rebuild: the CSVs already are the gold contract
(``gold.facilities`` / ``geography`` / ``facility_capability_assessments`` /
``capability_evidence``), every value traceable to a real source column.

Targets local Postgres or Databricks Lakebase, same as ``load_db.py``::

    python -m src.load_virtue                         # local (GIFT_INDIA_DB_URL / .env)
    python -m src.load_virtue --target lakebase \\
        --endpoint projects/gift_india/branches/production/endpoints/primary \\
        --profile <profile>
"""
from __future__ import annotations

import argparse
from pathlib import Path
from urllib.parse import quote

from . import db

DEFAULT_OWNER = "admins"
CSV_DIR = Path(__file__).resolve().parents[2] / "data" / "virtue"

# DDL for the four serving tables. Column names/types match the exported CSVs and
# the queries in gift_india_web/server/routes/gift_india/routes.ts.
DDL = """
CREATE SCHEMA IF NOT EXISTS gold;

DROP TABLE IF EXISTS gold.capability_evidence;
DROP TABLE IF EXISTS gold.facility_capability_assessments;
DROP TABLE IF EXISTS gold.facilities;
DROP TABLE IF EXISTS gold.geography;

CREATE TABLE gold.facilities (
  facility_id       text PRIMARY KEY,
  name              text NOT NULL,
  type              text,
  district          text,
  state             text,
  state_code        text,
  beds              integer,
  lat               double precision,
  lon               double precision,
  specialties       text,
  offers_surgery    boolean,
  annual_surgeries  integer,
  website_url       text,
  match_confidence  numeric
);

CREATE TABLE gold.geography (
  district                 text,
  state                    text,
  lat                      double precision,
  lon                      double precision,
  population               bigint,
  urbanity                 double precision,
  fp_unmet_pct             double precision,
  institutional_birth_pct  double precision,
  csection_pct             double precision,
  anaemia_pct              double precision,
  PRIMARY KEY (district, state)
);

CREATE TABLE gold.facility_capability_assessments (
  facility_id             text NOT NULL REFERENCES gold.facilities(facility_id),
  capability              text NOT NULL,
  capability_label        text,
  capability_description  text,
  claimed                 boolean,
  trust_signal            text,
  trust_score             numeric,
  evidence_count          integer,
  supporting_count        integer,
  contradicting_count     integer,
  best_source             text,
  summary                 text,
  PRIMARY KEY (facility_id, capability)
);

CREATE TABLE gold.capability_evidence (
  evidence_id   text,
  facility_id   text NOT NULL REFERENCES gold.facilities(facility_id),
  capability    text NOT NULL,
  source_type   text,
  source_label  text,
  source_url    text,
  stance        text,
  weight        numeric,
  snippet       text,
  observed_at   date NOT NULL DEFAULT current_date
);
CREATE INDEX ON gold.capability_evidence (facility_id, capability);
CREATE INDEX ON gold.facility_capability_assessments (capability, trust_signal);
"""

# (table, csv filename, explicit column list matching the CSV header)
LOADS = [
    ("gold.facilities", "facilities.csv",
     "facility_id,name,type,district,state,state_code,beds,lat,lon,specialties,"
     "offers_surgery,annual_surgeries,website_url,match_confidence"),
    ("gold.geography", "geography.csv",
     "district,state,lat,lon,population,urbanity,fp_unmet_pct,"
     "institutional_birth_pct,csection_pct,anaemia_pct"),
    ("gold.facility_capability_assessments", "facility_capability_assessments.csv",
     "facility_id,capability,capability_label,capability_description,claimed,"
     "trust_signal,trust_score,evidence_count,supporting_count,"
     "contradicting_count,best_source,summary"),
    ("gold.capability_evidence", "capability_evidence.csv",
     "facility_id,capability,evidence_id,source_type,source_label,source_url,"
     "stance,weight,snippet"),
]


def _sanitize_csv_cell(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.replace("\x00", "").strip()
    return value if value.lower() not in {"", "null", "none", "nan"} else ""


def _copy_csv(
    cur,
    table: str,
    columns: str,
    path: Path,
    *,
    dedupe_key: str | None = None,
    dedupe_keys: tuple[str, ...] | None = None,
) -> int:
    # Databricks CSV export writes SQL NULL as the literal token `null`.
    if dedupe_key or dedupe_keys:
        import csv
        import io

        key_fields = (dedupe_key,) if dedupe_key else tuple(dedupe_keys or ())
        with path.open("r", encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            fieldnames = reader.fieldnames or []
            seen: set[tuple[str, ...]] = set()
            buf = io.StringIO()
            writer = csv.DictWriter(buf, fieldnames=fieldnames, lineterminator="\n")
            writer.writeheader()
            for row in reader:
                parts = tuple(_sanitize_csv_cell(row.get(k)) or "" for k in key_fields)
                if not all(parts) or parts in seen:
                    continue
                seen.add(parts)
                writer.writerow(
                    {k: (_sanitize_csv_cell(v) or "null") for k, v in row.items()}
                )
        payload = buf.getvalue()
        with cur.copy(
            f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT CSV, HEADER true, NULL 'null')"
        ) as copy:
            copy.write(payload)
    else:
        import csv
        import io

        with path.open("r", encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            fieldnames = reader.fieldnames or []
            buf = io.StringIO()
            writer = csv.DictWriter(buf, fieldnames=fieldnames, lineterminator="\n")
            writer.writeheader()
            for row in reader:
                writer.writerow(
                    {k: (_sanitize_csv_cell(v) or "null") for k, v in row.items()}
                )
        payload = buf.getvalue()
        with cur.copy(
            f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT CSV, HEADER true, NULL 'null')"
        ) as copy:
            copy.write(payload)
    cur.execute(f"SELECT count(*) FROM {table}")
    return cur.fetchone()[0]


def _set_owner(conn, owner: str) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (owner,))
        if cur.fetchone() is None:
            print(f"  skip owner transfer: role {owner!r} does not exist on Lakebase")
            return
        cur.execute(f'ALTER SCHEMA gold OWNER TO "{owner}"')
        cur.execute(
            "SELECT 'gold.' || tablename FROM pg_tables WHERE schemaname = 'gold'"
        )
        for (rel,) in cur.fetchall():
            cur.execute(f'ALTER TABLE {rel} OWNER TO "{owner}"')
    conn.commit()


def _lakebase_dsn(args) -> str:
    creds = db.lakebase_credentials(args.endpoint, args.profile)
    # Authenticate as the Databricks user; --owner only sets object ownership after load.
    user = args.user or db.current_user(args.profile)
    return (
        f"postgresql://{quote(user)}:{quote(creds['token'])}@"
        f"{creds['host']}:5432/{args.database}?sslmode=require"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["local", "lakebase"], default="local")
    parser.add_argument("--dsn", help="Explicit Postgres DSN (local target).")
    parser.add_argument("--endpoint", help="Lakebase endpoint resource path.")
    parser.add_argument("--profile", help="Databricks CLI profile.")
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--user", help="Override Lakebase login role (default --owner).")
    parser.add_argument("--database", default="gift_india")
    parser.add_argument("--csv-dir", default=str(CSV_DIR))
    args = parser.parse_args(argv)

    csv_dir = Path(args.csv_dir)
    missing = [f for _, f, _ in LOADS if not (csv_dir / f).exists()]
    if missing:
        parser.error(
            f"missing CSV(s) in {csv_dir}: {missing}. "
            "Run `python data/export_virtue.py` first."
        )

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
        with conn.cursor() as cur:
            cur.execute(DDL)
        conn.commit()
        for table, fname, cols in LOADS:
            with conn.cursor() as cur:
                if table == "gold.facilities":
                    dedupe_key, dedupe_keys = "facility_id", None
                elif table == "gold.facility_capability_assessments":
                    dedupe_key, dedupe_keys = None, ("facility_id", "capability")
                else:
                    dedupe_key, dedupe_keys = None, None
                n = _copy_csv(
                    cur, table, cols, csv_dir / fname,
                    dedupe_key=dedupe_key, dedupe_keys=dedupe_keys,
                )
            conn.commit()
            print(f"  loaded {n:,} rows -> {table}")
        if args.target == "lakebase":
            owner = args.owner or db.current_user(args.profile)
            _set_owner(conn, owner)
            print(f"  gold.* owned by {owner!r}")

    print(f"Done. Real VF gold.* served on {where}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
