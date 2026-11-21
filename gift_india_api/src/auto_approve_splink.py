"""Bulk-approve Splink merge recommendations and print an MDM impact report.

Approves candidates in ``bronze.merge_candidates``, resolves duplicate flags,
rebuilds ``bronze.facility_clusters``, and optionally refreshes data-quality
flags. Run ``make dbt`` (or ``dbt run --select facility_master*``) afterward to
refresh ``gold.facility_master``.

Examples
--------
Approve strong Splink recommendations (``merge`` + ``link``, prob ≥ 0.92)::

    python -m src.auto_approve_splink

Approve every non-``distinct`` recommendation (includes ``review`` tier)::

    python -m src.auto_approve_splink --all

Full local pipeline::

    make auto-approve-splink
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import psycopg
from loguru import logger

from . import db
from .apply_merge_reviews import run as apply_clusters
from .refresh_data_quality_flags import _ensure_app_schema, refresh_flags

# Match gift_india_web `currentUser()` default so auto-approvals appear on My reviews.
_REVIEWER = os.environ.get("GIFT_INDIA_REVIEWER", "local-dev@gift_india")


def _snapshot(conn: psycopg.Connection) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT recommendation, COUNT(*)::int
            FROM bronze.merge_candidates
            GROUP BY recommendation
            ORDER BY COUNT(*) DESC
            """
        )
        by_recommendation = {row[0]: row[1] for row in cur.fetchall()}

        cur.execute("SELECT COUNT(*)::int FROM bronze.merge_candidates")
        merge_candidates = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT COUNT(*)::int FROM app.merge_reviews
            WHERE decision = 'merge'
            """
        )
        approved_merges = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT COUNT(*)::int FROM bronze.merge_candidates mc
            WHERE NOT EXISTS (
              SELECT 1 FROM app.merge_reviews mr
              WHERE mr.candidate_id = mc.candidate_id
                AND mr.decision IN ('merge', 'reject')
            )
            """
        )
        pending_reviews = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT COUNT(*)::int FROM app.data_quality_flags
            WHERE status = 'open' AND flag_type = 'duplicate_pair'
            """
        )
        open_duplicate_flags = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT COUNT(*)::int FROM app.data_quality_flags
            WHERE status = 'open'
            """
        )
        open_flags_total = int(cur.fetchone()[0])

        cur.execute("SELECT COUNT(*)::int FROM bronze.facility_clusters")
        cluster_rows = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT COUNT(DISTINCT master_facility_id)::int
            FROM bronze.facility_clusters
            """
        )
        master_ids = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT COUNT(DISTINCT master_facility_id)::int
            FROM bronze.facility_clusters
            WHERE member_count > 1
            """
        )
        multi_member_masters = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT COALESCE(SUM(member_count), 0)::int
            FROM bronze.facility_clusters
            WHERE member_count > 1
            """
        )
        records_in_merged_clusters = int(cur.fetchone()[0])

        cur.execute(
            """
            SELECT cluster_method, COUNT(*)::int
            FROM bronze.facility_clusters
            GROUP BY cluster_method
            """
        )
        by_cluster_method = {row[0]: row[1] for row in cur.fetchall()}

        gold_multi = 0
        if _relation_exists(cur, "gold.facility_master"):
            cur.execute(
                """
                SELECT COUNT(*)::int FROM gold.facility_master
                WHERE member_count > 1
                """
            )
            row = cur.fetchone()
            gold_multi = int(row[0]) if row and row[0] is not None else 0

    return {
        "merge_candidates": merge_candidates,
        "by_recommendation": by_recommendation,
        "approved_merges": approved_merges,
        "pending_reviews": pending_reviews,
        "open_duplicate_flags": open_duplicate_flags,
        "open_flags_total": open_flags_total,
        "cluster_rows": cluster_rows,
        "master_ids": master_ids,
        "multi_member_masters": multi_member_masters,
        "records_in_merged_clusters": records_in_merged_clusters,
        "by_cluster_method": by_cluster_method,
        "gold_multi_member_masters": gold_multi,
    }


def _relation_exists(cur: psycopg.Cursor, name: str) -> bool:
    schema, table = name.split(".", 1)
    cur.execute(
        """
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = %s AND table_name = %s
        UNION ALL
        SELECT 1
        FROM information_schema.views
        WHERE table_schema = %s AND table_name = %s
        LIMIT 1
        """,
        (schema, table, schema, table),
    )
    return cur.fetchone() is not None


def _recommendation_filter(include_all: bool) -> tuple[str, list[str]]:
    if include_all:
        return "recommendation != %s", ["distinct"]
    return "recommendation IN (%s, %s)", ["merge", "link"]


def approve_recommendations(
    conn: psycopg.Connection,
    *,
    include_all: bool,
    dry_run: bool,
) -> int:
    where_sql, params = _recommendation_filter(include_all)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT COUNT(*)::int
            FROM bronze.merge_candidates mc
            WHERE {where_sql}
              AND NOT EXISTS (
                SELECT 1 FROM app.merge_reviews mr
                WHERE mr.candidate_id = mc.candidate_id
                  AND mr.decision IN ('merge', 'reject')
              )
            """,
            params,
        )
        to_approve = int(cur.fetchone()[0])
        if dry_run or to_approve == 0:
            return to_approve

        cur.execute(
            f"""
            INSERT INTO app.merge_reviews (candidate_id, decision, reviewed_by, note)
            SELECT mc.candidate_id, 'merge', %s,
                   'Auto-approved Splink recommendation (' || mc.recommendation
                   || ', p=' || ROUND(mc.match_probability::numeric, 2) || ')'
            FROM bronze.merge_candidates mc
            WHERE {where_sql}
              AND NOT EXISTS (
                SELECT 1 FROM app.merge_reviews mr
                WHERE mr.candidate_id = mc.candidate_id
                  AND mr.decision IN ('merge', 'reject')
              )
            """,
            [_REVIEWER, *params],
        )
        inserted = cur.rowcount

        cur.execute(
            """
            UPDATE app.data_quality_flags dq
            SET status = 'resolved',
                resolved_at = NOW(),
                resolved_by = %s
            FROM bronze.merge_candidates mc
            JOIN app.merge_reviews mr ON mr.candidate_id = mc.candidate_id
            WHERE dq.flag_type = 'duplicate_pair'
              AND dq.related_id = mc.candidate_id
              AND dq.status = 'open'
              AND mr.decision = 'merge'
              AND mr.reviewed_by = %s
              AND mr.created_at >= NOW() - INTERVAL '5 minutes'
            """,
            [_REVIEWER, _REVIEWER],
        )
    conn.commit()
    return inserted if inserted is not None and inserted >= 0 else to_approve


def impact_report(before: dict[str, Any], after: dict[str, Any], approved: int) -> dict[str, Any]:
    return {
        "approved_pairs": approved,
        "before": before,
        "after": after,
        "delta": {
            "approved_merges": after["approved_merges"] - before["approved_merges"],
            "pending_reviews": after["pending_reviews"] - before["pending_reviews"],
            "open_duplicate_flags": after["open_duplicate_flags"] - before["open_duplicate_flags"],
            "open_flags_total": after["open_flags_total"] - before["open_flags_total"],
            "multi_member_masters": after["multi_member_masters"] - before["multi_member_masters"],
            "master_ids": after["master_ids"] - before["master_ids"],
            "records_in_merged_clusters": (
                after["records_in_merged_clusters"] - before["records_in_merged_clusters"]
            ),
            "cluster_rows": after["cluster_rows"] - before["cluster_rows"],
        },
    }


def _print_report(report: dict[str, Any]) -> None:
    before = report["before"]
    after = report["after"]
    delta = report["delta"]
    print("\n=== Splink auto-approve impact report ===\n")
    print(f"Pairs auto-approved: {report['approved_pairs']:,}")
    print(f"Merge reviews (merge): {before['approved_merges']:,} → {after['approved_merges']:,} ({delta['approved_merges']:+,})")
    print(f"Pending human review: {before['pending_reviews']:,} → {after['pending_reviews']:,} ({delta['pending_reviews']:+,})")
    print(f"Open duplicate flags: {before['open_duplicate_flags']:,} → {after['open_duplicate_flags']:,} ({delta['open_duplicate_flags']:+,})")
    print(f"Open flags (all types): {before['open_flags_total']:,} → {after['open_flags_total']:,} ({delta['open_flags_total']:+,})")
    print()
    print(f"Distinct master IDs: {before['master_ids']:,} → {after['master_ids']:,} ({delta['master_ids']:+,})")
    print(
        f"Multi-record masters: {before['multi_member_masters']:,} → "
        f"{after['multi_member_masters']:,} ({delta['multi_member_masters']:+,})"
    )
    print(
        f"Source records in merged clusters: {before['records_in_merged_clusters']:,} → "
        f"{after['records_in_merged_clusters']:,} ({delta['records_in_merged_clusters']:+,})"
    )
    print(f"Cluster rows: {before['cluster_rows']:,} → {after['cluster_rows']:,}")
    print(f"Cluster methods (after): {json.dumps(after['by_cluster_method'], indent=2)}")
    if after["gold_multi_member_masters"]:
        print(f"gold.facility_master multi-member masters: {after['gold_multi_member_masters']:,}")
    print("\nRecommendations remaining:", json.dumps(after["by_recommendation"], indent=2))
    print()


def run(
    *,
    include_all: bool = False,
    dry_run: bool = False,
    skip_clusters: bool = False,
    skip_flags: bool = False,
    json_out: bool = False,
) -> dict[str, Any]:
    if not db.is_configured():
        raise SystemExit("No database configured — set GIFT_INDIA_DB_URL or GIFT_INDIA_PG*.")

    with db.connect() as conn:
        _ensure_app_schema(conn)
        before = _snapshot(conn)
        approved = approve_recommendations(conn, include_all=include_all, dry_run=dry_run)
        if dry_run:
            after = before
        else:
            if not skip_clusters and approved > 0:
                apply_clusters()
            if not skip_flags:
                refresh_flags(conn)
            after = _snapshot(conn)

    report = impact_report(before, after, approved)
    if json_out:
        print(json.dumps(report, indent=2))
    else:
        _print_report(report)
    if dry_run:
        logger.info("Dry run — no merge reviews written")
    else:
        logger.success(
            "Auto-approved {} Splink pair(s); {} multi-record masters",
            approved,
            after["multi_member_masters"],
        )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--all",
        action="store_true",
        help="Approve merge + link + review tiers (exclude distinct only).",
    )
    parser.add_argument("--dry-run", action="store_true", help="Count approvals without writing.")
    parser.add_argument("--skip-clusters", action="store_true")
    parser.add_argument("--skip-flags", action="store_true")
    parser.add_argument("--json", action="store_true", dest="json_out")
    args = parser.parse_args(argv)
    run(
        include_all=args.all,
        dry_run=args.dry_run,
        skip_clusters=args.skip_clusters,
        skip_flags=args.skip_flags,
        json_out=args.json_out,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
