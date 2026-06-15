"""Land scraped facility website snapshots into ``bronze.facility_web_crawl``.

``src.scraper`` fetches each facility's official ``website_url`` and writes a raw
HTML snapshot, an extracted JSON, and a ``manifest.json`` under ``data/scraped/``.
This module reads that output and loads one **bronze** row per crawl attempt into
``bronze.facility_web_crawl`` — the raw, append-target landing table that keeps
source-native fidelity (verbatim ``raw_html`` + boilerplate-stripped ``raw_text``)
so the downstream silver extraction step is always replayable.

Like ``src.load_db`` it targets local Postgres or Databricks Lakebase, and loads
are **idempotent**: ``crawl_id`` is a hash of ``website_url`` + ``crawled_at``, so
re-loading the same manifest inserts nothing new (``ON CONFLICT DO NOTHING``),
while a fresh scrape (new ``crawled_at``) appends new crawl history.

Examples
--------
Scrape first, then land the snapshots in local Postgres::

    python -m src.scraper
    python -m src.load_crawl

Load a specific scrape directory into Lakebase::

    python -m src.load_crawl --target lakebase \\
        --endpoint projects/carenavigator/branches/production/endpoints/primary \\
        --profile <profile> --source data/scraped
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from loguru import logger

from . import db
from .load_db import DEFAULT_OWNER, _ensure_schema, _lakebase_dsn
from .scraper import DEFAULT_OUT_DIR, facility_subdir

_CRAWL_COLS = [
    "crawl_id", "facility_id", "name", "website_url", "final_url",
    "crawled_at", "status", "http_status", "content_type", "title",
    "raw_html", "raw_text", "error",
]


def _crawl_id(website_url: str, crawled_at: str) -> str:
    digest = hashlib.sha256(f"{website_url}\n{crawled_at}".encode("utf-8"))
    return digest.hexdigest()


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:  # noqa: BLE001
        logger.warning("Could not read {}: {}", path, exc)
        return {}


def _resolve(out_dir: Path, record: dict, key: str, default_name: str) -> Path | None:
    """Resolve a per-facility artifact path from the manifest (with fallback)."""
    raw = record.get(key)
    if raw:
        path = Path(raw)
        if path.exists():
            return path
    candidate = (
        facility_subdir(
            out_dir,
            facility_id=str(record.get("facility_id") or ""),
            name=record.get("name") or "",
            state=record.get("state") or "",
            district=record.get("district") or "",
        )
        / default_name
    )
    return candidate if candidate.exists() else None


def crawl_rows(out_dir: Path = DEFAULT_OUT_DIR) -> list[tuple]:
    """Build ``bronze.facility_web_crawl`` rows from a scrape ``manifest.json``."""
    manifest_path = out_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(
            f"No scrape manifest at {manifest_path}. Run `python -m src.scraper` "
            "(or `make scrape`) first to populate data/scraped/."
        )

    manifest = _read_json(manifest_path)
    records = manifest.get("records", [])
    rows: list[tuple] = []
    seen: set[str] = set()
    for record in records:
        website_url = record.get("url")
        if not website_url:
            continue
        crawled_at = record.get("fetched_at") or datetime.now(timezone.utc).isoformat(
            timespec="seconds"
        )
        crawl_id = _crawl_id(website_url, crawled_at)
        if crawl_id in seen:  # defend against a duplicated manifest entry
            continue
        seen.add(crawl_id)

        raw_html = raw_text = title = None
        html_path = _resolve(out_dir, record, "html_path", "page.html")
        if html_path:
            try:
                raw_html = html_path.read_text(encoding="utf-8")
            except OSError as exc:  # noqa: BLE001
                logger.warning("Could not read {}: {}", html_path, exc)
        extracted_path = _resolve(out_dir, record, "extracted_path", "extracted.json")
        if extracted_path:
            extracted = _read_json(extracted_path)
            raw_text = extracted.get("text")
            title = extracted.get("title")
        title = title or record.get("title")

        rows.append(
            (
                crawl_id,
                record.get("facility_id") or None,
                record.get("name") or None,
                website_url,
                record.get("final_url"),
                crawled_at,
                record.get("status") or "ok",
                record.get("http_status"),
                record.get("content_type"),
                title,
                raw_html,
                raw_text,
                record.get("error"),
            )
        )
    return rows


def _load(conn, schema: str, rows: list[tuple]) -> int:
    """Append crawl rows, skipping any already-landed ``crawl_id``."""
    if not rows:
        return 0
    cols = ", ".join(_CRAWL_COLS)
    placeholders = ", ".join(["%s"] * len(_CRAWL_COLS))
    sql = (
        f"INSERT INTO {schema}.facility_web_crawl ({cols}) "
        f"VALUES ({placeholders}) ON CONFLICT (crawl_id) DO NOTHING"
    )
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
        inserted = cur.rowcount
    conn.commit()
    # executemany rowcount can be -1 on some drivers; fall back to len(rows).
    return inserted if inserted is not None and inserted >= 0 else len(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", type=Path, default=DEFAULT_OUT_DIR,
        help=f"Scrape output directory to load (default: {DEFAULT_OUT_DIR}).",
    )
    parser.add_argument(
        "--target", choices=["local", "lakebase"], default="local",
        help="Where to load the crawl rows (default: local).",
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

    rows = crawl_rows(args.source)
    if not rows:
        logger.warning(
            "No crawl records found in {}. Run `make scrape` against facilities "
            "that have a `website_url` first.", args.source,
        )
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
        inserted = _load(conn, args.schema, rows)

    skipped = len(rows) - inserted
    logger.success(
        "Landed {} crawl row(s) into {}.facility_web_crawl on {} "
        "({} already present).", inserted, args.schema, where, max(skipped, 0),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
