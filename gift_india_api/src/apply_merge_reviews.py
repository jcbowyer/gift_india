"""Build bronze.facility_clusters from Splink merge reviews.

Every bronze source record (virtue, jci, nabh, pmjay) starts as a singleton
cluster. Pairs with `decision = 'merge'` in app.merge_reviews are unioned;
each connected component receives a stable master_facility_id (preferring a
Virtue facility_id when present).

Examples
--------
Rebuild clusters after human merge reviews::

    python -m src.apply_merge_reviews

Typical pipeline::

    make splink-duplicates
    # … review pairs in Data Quality UI …
    make apply-merge-clusters
    make dbt
"""
from __future__ import annotations

import argparse
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import psycopg
from loguru import logger

from . import db
from .splink_duplicates import _load_records, _split_uid

_SCHEMA_SQL = Path(__file__).resolve().parents[2] / "db" / "schema.sql"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _uid(source: str, record_id: str) -> str:
    return f"{source}|{record_id}"


class _UnionFind:
    def __init__(self, nodes: Iterable[str]) -> None:
        self._parent = {n: n for n in nodes}

    def find(self, node: str) -> str:
        parent = self._parent[node]
        if parent != node:
            self._parent[node] = self.find(parent)
        return self._parent[node]

    def union(self, left: str, right: str) -> None:
        root_l = self.find(left)
        root_r = self.find(right)
        if root_l != root_r:
            self._parent[root_r] = root_l


def _pick_master_id(
    members: list[tuple[str, str]],
    virtue_confidence: dict[str, float],
) -> str:
    """Prefer a Virtue facility_id; otherwise a stable synthetic master id."""
    virtue_members = [(source, record_id) for source, record_id in members if source == "virtue"]
    if virtue_members:
        _, best_id = max(
            virtue_members,
            key=lambda pair: virtue_confidence.get(pair[1], 0.0),
        )
        return best_id

    stable = "|".join(sorted(f"{source}|{record_id}" for source, record_id in members))
    digest = hashlib.sha256(stable.encode("utf-8")).hexdigest()[:12]
    return f"MF-{digest}"


def _load_approved_edges(conn: psycopg.Connection) -> list[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT mc.left_source, mc.left_id, mc.right_source, mc.right_id
            FROM bronze.merge_candidates mc
            JOIN LATERAL (
                SELECT decision
                FROM app.merge_reviews
                WHERE candidate_id = mc.candidate_id
                ORDER BY created_at DESC
                LIMIT 1
            ) mr ON TRUE
            WHERE mr.decision = 'merge'
            """
        )
        return [
            (_uid(row[0], row[1]), _uid(row[2], row[3]))
            for row in cur.fetchall()
        ]


def build_facility_clusters(
    *,
    unique_ids: Iterable[str],
    edges: Iterable[tuple[str, str]],
    virtue_confidence: dict[str, float],
) -> list[dict[str, object]]:
    nodes = set(unique_ids)
    uf = _UnionFind(nodes)
    for left, right in edges:
        if left in nodes and right in nodes:
            uf.union(left, right)

    groups: dict[str, list[str]] = {}
    for node in nodes:
        groups.setdefault(uf.find(node), []).append(node)

    built_at = _now_iso()
    records: list[dict[str, object]] = []
    for members in groups.values():
        parsed = [_split_uid(member) for member in members]
        master_id = _pick_master_id(parsed, virtue_confidence)
        method = "splink_approved" if len(members) > 1 else "singleton"
        member_count = len(members)
        for source, record_id in parsed:
            records.append(
                {
                    "source_system": source,
                    "source_id": record_id,
                    "master_facility_id": master_id,
                    "cluster_method": method,
                    "member_count": member_count,
                    "built_at": built_at,
                }
            )
    return records


def load_facility_clusters(conn: psycopg.Connection, clusters: list[dict[str, object]]) -> int:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM bronze.facility_clusters")
        if not clusters:
            conn.commit()
            return 0
        rows = [
            (
                r["source_system"],
                r["source_id"],
                r["master_facility_id"],
                r["cluster_method"],
                r["member_count"],
                r["built_at"],
            )
            for r in clusters
        ]
        cur.executemany(
            """
            INSERT INTO bronze.facility_clusters (
              source_system, source_id, master_facility_id,
              cluster_method, member_count, built_at
            ) VALUES (%s, %s, %s, %s, %s, %s)
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def run() -> int:
    if not db.is_configured():
        raise SystemExit("No database configured — set GIFT_INDIA_DB_URL or PG* env vars.")

    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_SCHEMA_SQL.read_text())
        conn.commit()

        df = _load_records(conn)
        if df.empty:
            logger.warning("No bronze facility records found for clustering")
            return 0

        virtue_confidence = {
            str(row.record_id): float(row.match_confidence or 0.0)
            for row in df[df["source"] == "virtue"].itertuples(index=False)
            if row.match_confidence is not None
        }
        unique_ids = df["unique_id"].astype(str).tolist()
        edges = _load_approved_edges(conn)
        clusters = build_facility_clusters(
            unique_ids=unique_ids,
            edges=edges,
            virtue_confidence=virtue_confidence,
        )
        n = load_facility_clusters(conn, clusters)
        merged_masters = len(
            {c["master_facility_id"] for c in clusters if c["member_count"] > 1}
        )
        logger.info(
            "Landed {} cluster rows ({} multi-record masters from {} approved merge edges)",
            n,
            merged_masters,
            len(edges),
        )
        return n


def main(argv: Iterable[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Apply Splink merge reviews → bronze.facility_clusters"
    )
    parser.parse_args(list(argv) if argv is not None else None)
    run()


if __name__ == "__main__":
    main()
