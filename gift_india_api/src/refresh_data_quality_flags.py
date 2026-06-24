"""Refresh automated data-quality flags in app.data_quality_flags.

Runs after dbt build and/or Splink duplicate detection. Flags are surfaced on the
Data Quality page for human-in-the-loop resolution.

Examples::

    python -m src.refresh_data_quality_flags
"""
from __future__ import annotations

import argparse
from pathlib import Path

import psycopg
from loguru import logger

from . import db

_SCHEMA_SQL = Path(__file__).resolve().parents[2] / "db" / "schema.sql"

APP_DDL = """
CREATE SCHEMA IF NOT EXISTS app;
CREATE TABLE IF NOT EXISTS app.merge_reviews (
  id              SERIAL PRIMARY KEY,
  candidate_id    TEXT NOT NULL,
  decision        TEXT NOT NULL,
  reviewed_by     TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS merge_reviews_candidate_idx ON app.merge_reviews (candidate_id);
CREATE TABLE IF NOT EXISTS app.website_url_updates (
  id              SERIAL PRIMARY KEY,
  facility_id     TEXT NOT NULL,
  facility_name   TEXT,
  old_url         TEXT,
  new_url         TEXT NOT NULL,
  reviewed_by     TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS app.data_quality_flags (
  id              SERIAL PRIMARY KEY,
  facility_id     TEXT NOT NULL,
  flag_type       TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'medium',
  detail          TEXT,
  related_id      TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS data_quality_flags_open_unique
  ON app.data_quality_flags (facility_id, flag_type, COALESCE(related_id, ''))
  WHERE status = 'open';
"""


def _ensure_app_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(_SCHEMA_SQL.read_text())
        cur.execute(APP_DDL)
    conn.commit()


def refresh_flags(conn: psycopg.Connection) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM app.data_quality_flags WHERE status = 'open' AND flag_type != 'duplicate_pair'"
        )

        cur.execute(
            """
            INSERT INTO app.data_quality_flags (facility_id, flag_type, severity, detail)
            SELECT f.facility_id, 'missing_url', 'medium',
                   'No website URL on record — crawl cannot corroborate claims.'
            FROM gold.facilities f
            WHERE (f.website_url IS NULL OR TRIM(f.website_url) = '')
              AND NOT EXISTS (
                SELECT 1 FROM app.data_quality_flags dq
                WHERE dq.facility_id = f.facility_id
                  AND dq.flag_type = 'missing_url'
                  AND dq.status = 'open'
              )
            """
        )
        missing = cur.rowcount

        cur.execute(
            """
            INSERT INTO app.data_quality_flags (facility_id, flag_type, severity, detail)
            SELECT f.facility_id, 'low_confidence', 'high',
                   'Entity match confidence ' || ROUND(f.match_confidence::numeric, 2)
                   || ' — below 0.70 review threshold.'
            FROM gold.facilities f
            WHERE f.match_confidence < 0.70
              AND NOT EXISTS (
                SELECT 1 FROM app.data_quality_flags dq
                WHERE dq.facility_id = f.facility_id
                  AND dq.flag_type = 'low_confidence'
                  AND dq.status = 'open'
              )
            """
        )
        low_conf = cur.rowcount

        cur.execute(
            """
            INSERT INTO app.data_quality_flags (facility_id, flag_type, severity, detail, related_id)
            SELECT a.facility_id, 'contradiction', 'high',
                   a.capability || ': '
                   || a.contradicting_count || ' contradicting evidence item(s).',
                   a.capability
            FROM gold.facility_capability_assessments a
            WHERE a.contradicting_count > 0
              AND NOT EXISTS (
                SELECT 1 FROM app.data_quality_flags dq
                WHERE dq.facility_id = a.facility_id
                  AND dq.flag_type = 'contradiction'
                  AND dq.related_id = a.capability
                  AND dq.status = 'open'
              )
            """
        )
        contradictions = cur.rowcount

        cur.execute(
            """
            DELETE FROM app.data_quality_flags
            WHERE flag_type = 'duplicate_pair' AND status = 'open'
            """
        )

        cur.execute(
            """
            INSERT INTO app.data_quality_flags (facility_id, flag_type, severity, detail, related_id)
            SELECT
              CASE WHEN mc.left_source = 'virtue' THEN mc.left_id ELSE mc.right_id END,
              'duplicate_pair',
              CASE WHEN mc.match_probability >= 0.92 THEN 'high' ELSE 'medium' END,
              'Splink merge recommendation (' || ROUND(mc.match_probability::numeric, 2)
                || ') — ' || mc.left_source || ' ↔ ' || mc.right_source || '.',
              mc.candidate_id
            FROM bronze.merge_candidates mc
            WHERE (mc.left_source = 'virtue' OR mc.right_source = 'virtue')
              AND mc.match_probability >= 0.55
              AND NOT EXISTS (
                SELECT 1 FROM app.merge_reviews mr
                WHERE mr.candidate_id = mc.candidate_id
                  AND mr.decision IN ('merge', 'reject')
              )
            """
        )
        duplicates = cur.rowcount

    conn.commit()
    return {
        "missing_url": missing,
        "low_confidence": low_conf,
        "contradiction": contradictions,
        "duplicate_pair": duplicates,
    }


def run() -> dict[str, int]:
    if not db.is_configured():
        raise SystemExit("No database configured — set GIFT_INDIA_DB_URL or PG* env vars.")
    with db.connect() as conn:
        _ensure_app_schema(conn)
        counts = refresh_flags(conn)
        logger.info("Refreshed data quality flags: {}", counts)
        return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh app.data_quality_flags from gold + Splink")
    parser.parse_args()
    run()


if __name__ == "__main__":
    main()
