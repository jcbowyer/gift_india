"""Ingest the Medical Value Travel (MVT) hospital seed into
``bronze.locations_medical_travel``.

Source: the public Hugging Face dataset
``Dhanush008/india-medical-value-travel-mvp`` (file ``mvt_dataset.json``) — a
synthetic-but-realistic catalogue of India hospitals running international
patient programs (program tier, accreditations, specialties, countries served,
international patient volumes). We ingest only its ``hospitals`` array.

Two steps, both handled here (the download is trivial, so unlike the JCI scraper
there is no separate compile step):

* **fetch** — download ``mvt_dataset.json`` into the ``data/medical_travel``
  cache (skipped if already present; force a refresh with ``--refresh``), then
  write a normalized ``locations_medical_travel.json`` next to it for inspection.
* **load** — upsert one **bronze** row per hospital into
  ``bronze.locations_medical_travel`` — the raw medical-tourism REFERENCE landing
  table that dbt resolves to facility_ids (silver -> gold) on the normalized
  ``match_name`` / ``brand_key`` (the same entity-resolution keys the JCI seed
  uses). List-valued fields are stored pipe-delimited, like
  ``bronze.facilities.specialties``.

Like ``src.load_jci`` it targets local Postgres or Databricks Lakebase, and loads
are **idempotent**: ``mvt_id`` is the source hospital id (e.g. ``H001``), so
re-loading the same set updates rows in place (``ON CONFLICT``).

Examples
--------
Fetch the dataset (if not cached) and land it in local Postgres::

    python -m src.load_med_travel

Re-download then load::

    python -m src.load_med_travel --refresh

Load into Lakebase::

    python -m src.load_med_travel --target lakebase \\
        --endpoint projects/gift_india/branches/production/endpoints/primary \\
        --profile <profile>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import requests
from loguru import logger

from . import db
from .jci_scraper import _now_iso, brand_key, normalize_name
from .load_db import DEFAULT_OWNER, _ensure_schema, _lakebase_dsn

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "medical_travel"
RAW_PATH = DATA_DIR / "mvt_dataset.json"
RECORDS_PATH = DATA_DIR / "locations_medical_travel.json"

SOURCE_URL = (
    "https://huggingface.co/datasets/Dhanush008/india-medical-value-travel-mvp/"
    "resolve/main/mvt_dataset.json"
)
DEFAULT_TIMEOUT = 30.0

_COLS = [
    "mvt_id", "name", "hospital_chain", "city", "state", "tier",
    "international_patient_program", "specialties", "countries_served",
    "has_ipc", "accreditation", "avg_cost_index", "beds", "established_year",
    "international_patients_annually", "phone", "email", "website_url",
    "match_name", "brand_key", "data_source", "source_url", "collected_at",
]


def _pipe(value) -> str:
    """Join a list-valued source field into a pipe-delimited string."""
    if not value:
        return ""
    if isinstance(value, str):
        return value.strip()
    return "|".join(str(v).strip() for v in value if str(v).strip())


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def fetch(*, refresh: bool = False, timeout: float = DEFAULT_TIMEOUT) -> dict:
    """Return the parsed MVT dataset, downloading it into the cache if needed."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if refresh or not RAW_PATH.exists():
        logger.info("Downloading MVT dataset from {}…", SOURCE_URL)
        resp = requests.get(SOURCE_URL, timeout=timeout)
        resp.raise_for_status()
        RAW_PATH.write_bytes(resp.content)
        logger.success("Cached raw dataset -> {} ({} bytes)", RAW_PATH, len(resp.content))
    else:
        logger.info("Using cached dataset at {} (pass --refresh to re-download).", RAW_PATH)
    return json.loads(RAW_PATH.read_text(encoding="utf-8"))


def build_records(dataset: dict, *, collected_at: str | None = None) -> list[dict]:
    """Map the dataset's ``hospitals`` array to ``bronze.locations_medical_travel`` rows."""
    collected_at = collected_at or _now_iso()
    records: list[dict] = []
    seen: set[str] = set()
    for h in dataset.get("hospitals", []):
        mvt_id = (h.get("id") or "").strip()
        name = (h.get("name") or "").strip()
        if not mvt_id or not name or mvt_id in seen:  # need a stable PK + a name
            continue
        seen.add(mvt_id)
        contact = h.get("contact") or {}
        records.append({
            "mvt_id": mvt_id,
            "name": name,
            "hospital_chain": h.get("hospital_chain"),
            "city": h.get("city"),
            "state": h.get("state"),
            "tier": _int(h.get("tier")),
            "international_patient_program": h.get("international_patient_program"),
            "specialties": _pipe(h.get("specialties")),
            "countries_served": _pipe(h.get("countries_served")),
            "has_ipc": bool(h.get("has_ipc")),
            "accreditation": _pipe(h.get("accreditation")),
            "avg_cost_index": h.get("avg_cost_index"),
            "beds": _int(h.get("beds")),
            "established_year": _int(h.get("established_year")),
            "international_patients_annually": _int(h.get("international_patients_annually")),
            "phone": contact.get("phone"),
            "email": contact.get("email"),
            "website_url": contact.get("website"),
            "match_name": normalize_name(name),
            "brand_key": brand_key(name),
            "data_source": "mvt",
            "source_url": SOURCE_URL,
            "collected_at": collected_at,
        })
    return records


def _load(conn, schema: str, records: list[dict]) -> int:
    """Upsert MVT rows; refresh mutable fields when a row already exists."""
    if not records:
        return 0
    cols = ", ".join(_COLS)
    placeholders = ", ".join(["%s"] * len(_COLS))
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in _COLS if c != "mvt_id")
    sql = (
        f"INSERT INTO {schema}.locations_medical_travel ({cols}) "
        f"VALUES ({placeholders}) "
        f"ON CONFLICT (mvt_id) DO UPDATE SET {updates}"
    )
    rows = [tuple(r.get(c) for c in _COLS) for r in records]
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    conn.commit()
    return len(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--refresh", action="store_true",
        help="Re-download the dataset even if a cached copy exists.",
    )
    parser.add_argument(
        "--target", choices=["local", "lakebase"], default="local",
        help="Where to load the MVT rows (default: local).",
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

    dataset = fetch(refresh=args.refresh)
    records = build_records(dataset)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RECORDS_PATH.write_text(
        json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    logger.info("Built {} MVT hospital record(s) -> {}", len(records), RECORDS_PATH)

    if not records:
        logger.warning("No MVT hospitals found in the dataset; nothing to load.")
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
        n = _load(conn, args.schema, records)

    logger.success(
        "Upserted {} MVT hospital(s) into {}.locations_medical_travel on {}.",
        n, args.schema, where,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
