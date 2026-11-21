"""Backfill missing website URLs on bronze.facilities_virtue from linked sources.

When Virtue rows lack a website but JCI, NABH, MDM clusters, or NHPR have one,
this script copies the best available URL into the governed spine and records the
change in app.website_url_updates for the Reviews page.

Priority (lowest rank wins):
  1. gold.facility_master  — Splink cluster survivorship
  2. gold.facility_nabh    — entity-resolved NABH register (confidence >= 0.70)
  3. gold.facility_jci     — entity-resolved JCI seed (confidence >= 0.70)
  4. bronze.locations_nhpr — tiered name match

Examples::

    python -m src.backfill_website_urls
    python -m src.backfill_website_urls --dry-run
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass

import psycopg
from loguru import logger

from . import db
from .jci_scraper import brand_key, normalize_name
from .refresh_data_quality_flags import _ensure_app_schema

_CROSSWALK_SQL = """
WITH candidates AS (
    SELECT
        b.source_id AS facility_id,
        fm.website_url,
        'facility_master'::text AS source_system,
        1 AS source_rank
    FROM gold.facility_master fm
    JOIN gold.facility_master_bridge b
      ON fm.master_facility_id = b.master_facility_id
     AND b.source_system = 'virtue'
    JOIN bronze.facilities_virtue v ON v.facility_id = b.source_id
    WHERE (v.website_url IS NULL OR TRIM(v.website_url) = '')
      AND fm.website_url IS NOT NULL
      AND TRIM(fm.website_url) != ''

    UNION ALL

    SELECT
        f.facility_id,
        n.nabh_website_url,
        'nabh',
        2
    FROM gold.facilities f
    JOIN gold.facility_nabh n ON f.facility_id = n.facility_id
    JOIN bronze.facilities_virtue v ON v.facility_id = f.facility_id
    WHERE (v.website_url IS NULL OR TRIM(v.website_url) = '')
      AND n.nabh_website_url IS NOT NULL
      AND TRIM(n.nabh_website_url) != ''
      AND n.match_confidence >= 0.70

    UNION ALL

    SELECT
        f.facility_id,
        j.jci_website_url,
        'jci',
        3
    FROM gold.facilities f
    JOIN gold.facility_jci j ON f.facility_id = j.facility_id
    JOIN bronze.facilities_virtue v ON v.facility_id = f.facility_id
    WHERE (v.website_url IS NULL OR TRIM(v.website_url) = '')
      AND j.jci_website_url IS NOT NULL
      AND TRIM(j.jci_website_url) != ''
      AND j.match_confidence >= 0.70
),
ranked AS (
    SELECT DISTINCT ON (facility_id)
        facility_id,
        website_url,
        source_system
    FROM candidates
    ORDER BY facility_id, source_rank
)
SELECT
    r.facility_id,
    v.name AS facility_name,
    r.website_url,
    r.source_system
FROM ranked r
JOIN bronze.facilities_virtue v ON v.facility_id = r.facility_id
"""


@dataclass(frozen=True)
class _VirtueRow:
    facility_id: str
    name: str
    district: str
    state: str
    match_name: str
    brand: str


@dataclass(frozen=True)
class _RefRow:
    source_system: str
    website_url: str
    match_name: str
    brand: str
    district: str
    state: str
    source_rank: int


def _load_missing_virtue(conn: psycopg.Connection) -> list[_VirtueRow]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT facility_id, name, district, state
            FROM bronze.facilities_virtue
            WHERE website_url IS NULL OR TRIM(website_url) = ''
            """
        )
        rows = cur.fetchall()
    out: list[_VirtueRow] = []
    for facility_id, name, district, state in rows:
        out.append(
            _VirtueRow(
                facility_id=str(facility_id),
                name=str(name or ""),
                district=str(district or ""),
                state=str(state or ""),
                match_name=normalize_name(name),
                brand=brand_key(name),
            )
        )
    return out


def _load_reference_urls(conn: psycopg.Connection) -> list[_RefRow]:
    refs: list[_RefRow] = []
    queries = [
        (
            "nhpr",
            4,
            """
            SELECT website_url, match_name, brand_key, COALESCE(district_name, ''), state_name
            FROM bronze.locations_nhpr
            WHERE website_url IS NOT NULL AND TRIM(website_url) != ''
              AND state_name IS NOT NULL AND TRIM(state_name) != ''
            """,
        ),
    ]
    with conn.cursor() as cur:
        for source_system, source_rank, sql in queries:
            try:
                cur.execute(sql)
            except psycopg.errors.UndefinedTable:
                conn.rollback()
                logger.warning("Skipping {} — table not loaded yet", source_system)
                continue
            for website_url, match_name, brand, district, state in cur.fetchall():
                url = str(website_url or "").strip()
                if not url:
                    continue
                refs.append(
                    _RefRow(
                        source_system=source_system,
                        website_url=url,
                        match_name=str(match_name or ""),
                        brand=str(brand or ""),
                        district=str(district or ""),
                        state=str(state or ""),
                        source_rank=source_rank,
                    )
                )
    return refs


@dataclass(frozen=True)
class _Match:
    website_url: str
    source_system: str
    score: int


def _tiered_match(virtue: _VirtueRow, refs: list[_RefRow]) -> _Match | None:
    state = virtue.state.strip().lower()
    district = virtue.district.strip().lower()
    best: _Match | None = None
    for ref in refs:
        if ref.state.strip().lower() != state:
            continue
        tier: int | None = None
        if virtue.match_name and ref.match_name and virtue.match_name == ref.match_name:
            tier = 1
        elif (
            virtue.brand
            and ref.brand
            and virtue.brand == ref.brand
            and district
            and ref.district.strip().lower() == district
        ):
            tier = 2
        elif virtue.brand and ref.brand and virtue.brand == ref.brand:
            tier = 3
        if tier is None:
            continue
        score = tier * 10 + ref.source_rank
        if best is None or score < best.score:
            best = _Match(ref.website_url, ref.source_system, score)
    return best


def _collect_candidates(conn: psycopg.Connection) -> dict[str, tuple[str, str, str]]:
    """facility_id -> (facility_name, website_url, source_system)."""
    picked: dict[str, tuple[str, str, str]] = {}

    with conn.cursor() as cur:
        cur.execute(_CROSSWALK_SQL)
        for facility_id, facility_name, website_url, source_system in cur.fetchall():
            picked[str(facility_id)] = (
                str(facility_name or ""),
                str(website_url).strip(),
                str(source_system),
            )

    refs = _load_reference_urls(conn)
    if refs:
        for virtue in _load_missing_virtue(conn):
            if virtue.facility_id in picked:
                continue
            match = _tiered_match(virtue, refs)
            if match:
                picked[virtue.facility_id] = (virtue.name, match.website_url, match.source_system)

    return picked


def backfill_website_urls(conn: psycopg.Connection, *, dry_run: bool = False) -> dict[str, int]:
    candidates = _collect_candidates(conn)
    if not candidates:
        logger.info("No website URL backfill candidates found.")
        return {"candidates": 0, "updated": 0}

    by_source: dict[str, int] = {}
    updated = 0

    with conn.cursor() as cur:
        for facility_id, (facility_name, new_url, source_system) in sorted(candidates.items()):
            by_source[source_system] = by_source.get(source_system, 0) + 1
            note = f"Auto-backfill from {source_system}"
            if dry_run:
                logger.info(
                    "Would backfill {} ({}) ← {} [{}]",
                    facility_name,
                    facility_id,
                    new_url,
                    source_system,
                )
                continue

            cur.execute(
                """
                UPDATE bronze.facilities_virtue
                SET website_url = %s
                WHERE facility_id = %s
                  AND (website_url IS NULL OR TRIM(website_url) = '')
                """,
                (new_url, facility_id),
            )
            if cur.rowcount == 0:
                continue
            updated += 1

            cur.execute(
                """
                INSERT INTO app.website_url_updates
                  (facility_id, facility_name, old_url, new_url, reviewed_by, note)
                VALUES (%s, %s, NULL, %s, 'backfill_website_urls', %s)
                """,
                (facility_id, facility_name, new_url, note),
            )
            cur.execute(
                """
                UPDATE app.data_quality_flags
                SET status = 'resolved', resolved_at = NOW(), resolved_by = 'backfill_website_urls'
                WHERE facility_id = %s
                  AND flag_type = 'missing_url'
                  AND status = 'open'
                """,
                (facility_id,),
            )

    if not dry_run:
        conn.commit()

    logger.info(
        "Website URL backfill: {} candidate(s), {} updated — by source: {}",
        len(candidates),
        updated,
        by_source,
    )
    return {"candidates": len(candidates), "updated": updated, **by_source}


def run(*, dry_run: bool = False) -> dict[str, int]:
    if not db.is_configured():
        raise SystemExit("No database configured — set GIFT_INDIA_DB_URL or PG* env vars.")
    with db.connect() as conn:
        _ensure_app_schema(conn)
        return backfill_website_urls(conn, dry_run=dry_run)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print candidates without updating bronze or app tables.",
    )
    args = parser.parse_args()
    run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
