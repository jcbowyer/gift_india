"""Probabilistic duplicate detection with Splink — merge recommendations for HITL review.

Reads bronze facility reference tables (virtue, jci, nabh, pmjay), blocks on
state + brand_key (same keys as dbt entity resolution), scores candidate pairs
with Splink, and lands recommendations in bronze.merge_candidates.

Examples
--------
Run against the configured Postgres / Lakebase target::

    python -m src.splink_duplicates

Refresh only (skip Splink if table already populated)::

    python -m src.splink_duplicates --skip-if-populated
"""
from __future__ import annotations

import argparse
import hashlib
import math
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable

import pandas as pd
import psycopg
from loguru import logger

from . import db
from .jci_scraper import brand_key, normalize_name

_SCHEMA_SQL = Path(__file__).resolve().parents[2] / "db" / "schema.sql"

MATCH_THRESHOLD = 0.55
MAX_VIRTUE_DEDUPE = 8000
MAX_CROSS_SOURCE = 12000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _candidate_id(left_source: str, left_id: str, right_source: str, right_id: str) -> str:
    a = f"{left_source}|{left_id}"
    b = f"{right_source}|{right_id}"
    pair = "|".join(sorted([a, b]))
    return hashlib.sha256(pair.encode("utf-8")).hexdigest()[:24]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _name_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _recommendation(prob: float, same_source: bool) -> str:
    if prob >= 0.92:
        return "merge" if same_source else "link"
    if prob >= 0.75:
        return "review"
    return "distinct"


def _load_records(conn: psycopg.Connection) -> pd.DataFrame:
    """Union bronze sources into a Splink-ready frame."""
    frames: list[pd.DataFrame] = []

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT facility_id AS record_id, name, state, district, lat, lon, match_confidence
            FROM bronze.facilities_virtue
            """
        )
        virtue = pd.DataFrame(
            cur.fetchall(),
            columns=["record_id", "name", "state", "district", "lat", "lon", "match_confidence"],
        )
        if not virtue.empty:
            virtue["source"] = "virtue"
            frames.append(virtue)

        for table, source, id_col, name_col, district_expr, lat_col, lon_col in [
            ("bronze.facilities_jci", "jci", "jci_org_id", "jci_name", "COALESCE(city, '')", "NULL", "NULL"),
            ("bronze.facilities_nabh", "nabh", "nabh_org_id", "nabh_name", "COALESCE(city, '')", "lat", "lng"),
            ("bronze.facilities_pmjay", "pmjay", "pmjay_org_id", "pmjay_name", "COALESCE(district, '')", "lat", "lng"),
        ]:
            cur.execute(
                f"""
                SELECT {id_col} AS record_id, {name_col} AS name, state,
                       {district_expr} AS district,
                       {lat_col} AS lat, {lon_col} AS lon,
                       NULL::double precision AS match_confidence
                FROM {table}
                WHERE state IS NOT NULL AND TRIM(state) != ''
                """
            )
            df = pd.DataFrame(
                cur.fetchall(),
                columns=["record_id", "name", "state", "district", "lat", "lon", "match_confidence"],
            )
            if not df.empty:
                df["source"] = source
                frames.append(df)

    if not frames:
        return pd.DataFrame()

    out = pd.concat(frames, ignore_index=True)
    out["name"] = out["name"].fillna("").astype(str)
    out["state"] = out["state"].fillna("").astype(str)
    out["district"] = out["district"].fillna("").astype(str)
    out["match_name"] = out["name"].map(normalize_name)
    out["brand_key"] = out["name"].map(lambda n: brand_key(n, 2))
    out = out[out["brand_key"].str.len() > 0].copy()
    out["unique_id"] = out["source"] + "|" + out["record_id"].astype(str)
    out["lat"] = pd.to_numeric(out["lat"], errors="coerce")
    out["lon"] = pd.to_numeric(out["lon"], errors="coerce")
    return out


def _deterministic_pairs(df: pd.DataFrame) -> pd.DataFrame:
    """Fallback / supplement: score blocked pairs without Splink training."""
    rows: list[dict] = []
    grouped = df.groupby(["state", "brand_key"], dropna=False)
    for (_, _), block in grouped:
        if len(block) < 2:
            continue
        recs = block.to_dict("records")
        for i in range(len(recs)):
            for j in range(i + 1, len(recs)):
                left, right = recs[i], recs[j]
                if left["unique_id"] == right["unique_id"]:
                    continue
                name_sim = _name_similarity(left["match_name"], right["match_name"])
                if name_sim < 0.72:
                    continue
                dist = None
                if (
                    pd.notna(left["lat"])
                    and pd.notna(left["lon"])
                    and pd.notna(right["lat"])
                    and pd.notna(right["lon"])
                ):
                    dist = _haversine_km(
                        float(left["lat"]),
                        float(left["lon"]),
                        float(right["lat"]),
                        float(right["lon"]),
                    )
                prob = name_sim
                if left["district"] and right["district"] and left["district"].lower() == right["district"].lower():
                    prob = min(0.99, prob + 0.08)
                if dist is not None and dist <= 2.0:
                    prob = min(0.99, prob + 0.1)
                elif dist is not None and dist > 25.0:
                    prob = max(0.0, prob - 0.15)
                if prob < MATCH_THRESHOLD:
                    continue
                same_source = left["source"] == right["source"]
                rows.append(
                    {
                        "unique_id_l": left["unique_id"],
                        "unique_id_r": right["unique_id"],
                        "match_probability": round(prob, 4),
                        "match_weight": round(prob * 10, 2),
                        "name_l": left["name"],
                        "name_r": right["name"],
                        "state_l": left["state"],
                        "district_l": left["district"],
                        "source_l": left["source"],
                        "source_r": right["source"],
                        "recommendation": _recommendation(prob, same_source),
                        "flag_reason": "Deterministic name + geo similarity within brand block",
                    }
                )
    return pd.DataFrame(rows)


def _splink_pairs(df: pd.DataFrame) -> pd.DataFrame:
    """Run Splink EM linkage on blocked candidate pairs."""
    try:
        import splink.duckdb.comparison_library as cl
        from splink.duckdb.linker import DuckDBLinker
    except ImportError as exc:
        logger.warning("Splink unavailable ({}) — using deterministic scoring only", exc)
        return pd.DataFrame()

    if len(df) < 2:
        return pd.DataFrame()

    work = df.copy()
    if len(work) > MAX_VIRTUE_DEDUPE + MAX_CROSS_SOURCE:
        virtue = work[work["source"] == "virtue"].head(MAX_VIRTUE_DEDUPE)
        external = work[work["source"] != "virtue"].head(MAX_CROSS_SOURCE)
        work = pd.concat([virtue, external], ignore_index=True)

    settings = {
        "link_type": "link_and_dedupe",
        "unique_id_column_name": "unique_id",
        "blocking_rules_to_generate_predictions": [
            "l.state = r.state AND l.brand_key = r.brand_key",
        ],
        "comparisons": [
            cl.exact_match("state"),
            cl.exact_match("district"),
            cl.jaro_winkler_at_thresholds("match_name", [0.95, 0.88, 0.75]),
        ],
        "retain_matching_columns": True,
        "additional_columns_to_retain": ["source", "name"],
        "probability_two_random_records_match": 0.002,
    }
    linker = DuckDBLinker(work, settings)
    linker.estimate_u_using_random_sampling(max_pairs=min(1e6, len(work) * 20))
    linker.estimate_parameters_using_expectation_maximisation(
        "l.state = r.state AND l.brand_key = r.brand_key"
    )
    pred = linker.predict(threshold_match_probability=MATCH_THRESHOLD).as_pandas_dataframe()
    if pred.empty:
        return pred

    out_rows: list[dict] = []
    for _, row in pred.iterrows():
        uid_l = str(row["unique_id_l"])
        uid_r = str(row["unique_id_r"])
        src_l = uid_l.split("|", 1)[0]
        src_r = uid_r.split("|", 1)[0]
        prob = float(row["match_probability"])
        same_source = src_l == src_r
        out_rows.append(
            {
                "unique_id_l": uid_l,
                "unique_id_r": uid_r,
                "match_probability": round(prob, 4),
                "match_weight": round(float(row.get("match_weight", prob * 10)), 2),
                "name_l": row.get("name_l") or row.get("match_name_l") or "",
                "name_r": row.get("name_r") or row.get("match_name_r") or "",
                "state_l": row.get("state_l") or "",
                "district_l": row.get("district_l") or "",
                "source_l": src_l,
                "source_r": src_r,
                "recommendation": _recommendation(prob, same_source),
                "flag_reason": "Splink probabilistic linkage (state + brand_key block)",
            }
        )
    return pd.DataFrame(out_rows)


def _split_uid(uid: str) -> tuple[str, str]:
    source, record_id = uid.split("|", 1)
    return source, record_id


def _merge_predictions(*frames: pd.DataFrame) -> pd.DataFrame:
    combined = pd.concat([f for f in frames if f is not None and not f.empty], ignore_index=True)
    if combined.empty:
        return combined
    combined["pair_key"] = combined.apply(
        lambda r: "|".join(sorted([str(r["unique_id_l"]), str(r["unique_id_r"])])), axis=1
    )
    combined = combined.sort_values("match_probability", ascending=False)
    combined = combined.drop_duplicates("pair_key", keep="first")
    return combined.drop(columns=["pair_key"])


def build_merge_candidates(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    splink_df = _splink_pairs(df)
    det_df = _deterministic_pairs(df)
    merged = _merge_predictions(splink_df, det_df)
    if merged.empty:
        return merged

    records: list[dict] = []
    for _, row in merged.iterrows():
        left_source, left_id = _split_uid(str(row["unique_id_l"]))
        right_source, right_id = _split_uid(str(row["unique_id_r"]))
        records.append(
            {
                "candidate_id": _candidate_id(left_source, left_id, right_source, right_id),
                "left_source": left_source,
                "left_id": left_id,
                "left_name": str(row.get("name_l") or ""),
                "right_source": right_source,
                "right_id": right_id,
                "right_name": str(row.get("name_r") or ""),
                "match_probability": float(row["match_probability"]),
                "match_weight": float(row.get("match_weight") or row["match_probability"] * 10),
                "state": str(row.get("state_l") or "") or None,
                "district": str(row.get("district_l") or "") or None,
                "recommendation": str(row.get("recommendation") or "review"),
                "flag_reason": str(row.get("flag_reason") or "Splink merge recommendation"),
                "computed_at": _now_iso(),
            }
        )
    return pd.DataFrame(records)


def _table_count(conn: psycopg.Connection, table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        return int(cur.fetchone()[0])


def load_merge_candidates(conn: psycopg.Connection, candidates: pd.DataFrame) -> int:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM bronze.merge_candidates")
        if candidates.empty:
            conn.commit()
            return 0
        rows = [
            (
                r.candidate_id,
                r.left_source,
                r.left_id,
                r.left_name,
                r.right_source,
                r.right_id,
                r.right_name,
                r.match_probability,
                r.match_weight,
                r.state,
                r.district,
                r.recommendation,
                r.flag_reason,
                r.computed_at,
            )
            for r in candidates.itertuples(index=False)
        ]
        cur.executemany(
            """
            INSERT INTO bronze.merge_candidates (
              candidate_id, left_source, left_id, left_name,
              right_source, right_id, right_name,
              match_probability, match_weight, state, district,
              recommendation, flag_reason, computed_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (candidate_id) DO UPDATE SET
              match_probability = EXCLUDED.match_probability,
              match_weight = EXCLUDED.match_weight,
              recommendation = EXCLUDED.recommendation,
              flag_reason = EXCLUDED.flag_reason,
              computed_at = EXCLUDED.computed_at
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def run(*, skip_if_populated: bool = False) -> int:
    if not db.is_configured():
        raise SystemExit("No database configured — set GIFT_INDIA_DB_URL or PG* env vars.")

    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_SCHEMA_SQL.read_text())
        conn.commit()

        if skip_if_populated and _table_count(conn, "bronze.merge_candidates") > 0:
            n = _table_count(conn, "bronze.merge_candidates")
            logger.info("bronze.merge_candidates already has {} rows — skipping Splink", n)
            return n

        df = _load_records(conn)
        if df.empty:
            logger.warning("No bronze facility records found for Splink")
            return 0

        logger.info("Running Splink on {} records across sources {}", len(df), df["source"].value_counts().to_dict())
        candidates = build_merge_candidates(df)
        n = load_merge_candidates(conn, candidates)
        logger.info("Landed {} merge recommendations in bronze.merge_candidates", n)
        return n


def main(argv: Iterable[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Splink duplicate finder → bronze.merge_candidates")
    parser.add_argument(
        "--skip-if-populated",
        action="store_true",
        help="Skip run when bronze.merge_candidates already has rows",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    run(skip_if_populated=args.skip_if_populated)


if __name__ == "__main__":
    main()
