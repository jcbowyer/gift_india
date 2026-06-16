"""Unit tests for landing scraped snapshots into ``bronze.facility_web_crawl``.

Exercises the manifest -> rows builder (including dedupe and raw_* hydration),
the idempotency-key hash, and the ``ON CONFLICT DO NOTHING`` insert against a
fake connection (no real Postgres).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src import load_crawl


# --------------------------------------------------------------- crawl_id
def test_crawl_id_is_deterministic_and_input_sensitive():
    a = load_crawl._crawl_id("https://x.test", "2026-06-15T00:00:00+00:00")
    assert a == load_crawl._crawl_id("https://x.test", "2026-06-15T00:00:00+00:00")
    assert a != load_crawl._crawl_id("https://x.test", "2026-06-15T01:00:00+00:00")
    assert a != load_crawl._crawl_id("https://y.test", "2026-06-15T00:00:00+00:00")
    assert len(a) == 64  # sha256 hexdigest


# --------------------------------------------------------------- crawl_rows
def _write_snapshot(out_dir: Path, *, text: str, title: str) -> tuple[Path, Path]:
    leaf = out_dir / "tamil-nadu" / "madurai" / "aravind-VF-1"
    leaf.mkdir(parents=True, exist_ok=True)
    html_path = leaf / "page.html"
    extracted_path = leaf / "extracted.json"
    html_path.write_text(f"<html><body>{text}</body></html>", encoding="utf-8")
    extracted_path.write_text(
        json.dumps({"title": title, "text": text}), encoding="utf-8"
    )
    return html_path, extracted_path


def _manifest(out_dir: Path, records: list[dict]) -> None:
    (out_dir / "manifest.json").write_text(
        json.dumps({"records": records}), encoding="utf-8"
    )


def test_crawl_rows_builds_row_with_hydrated_raw_fields(tmp_path):
    html_path, extracted_path = _write_snapshot(tmp_path, text="care@aravind.org", title="Aravind")
    _manifest(tmp_path, [{
        "facility_id": "VF-1", "name": "Aravind", "url": "https://aravind.org",
        "final_url": "https://aravind.org/", "fetched_at": "2026-06-15T00:00:00+00:00",
        "status": "ok", "http_status": 200, "content_type": "text/html",
        "title": "Aravind", "html_path": str(html_path), "extracted_path": str(extracted_path),
    }])

    rows = load_crawl.crawl_rows(tmp_path)
    assert len(rows) == 1
    row = dict(zip(load_crawl._CRAWL_COLS, rows[0]))

    assert row["facility_id"] == "VF-1"
    assert row["website_url"] == "https://aravind.org"
    assert row["final_url"] == "https://aravind.org/"
    assert row["status"] == "ok"
    assert row["http_status"] == 200
    assert row["title"] == "Aravind"
    assert "care@aravind.org" in row["raw_html"]
    assert row["raw_text"] == "care@aravind.org"  # from extracted.json
    assert row["crawl_id"] == load_crawl._crawl_id(
        "https://aravind.org", "2026-06-15T00:00:00+00:00"
    )


def test_crawl_rows_dedupes_identical_attempts(tmp_path):
    _write_snapshot(tmp_path, text="x", title="t")
    record = {
        "facility_id": "VF-1", "name": "Aravind", "url": "https://aravind.org",
        "fetched_at": "2026-06-15T00:00:00+00:00", "status": "ok",
    }
    _manifest(tmp_path, [record, dict(record)])  # same url + fetched_at twice
    rows = load_crawl.crawl_rows(tmp_path)
    assert len(rows) == 1  # identical crawl_id collapsed


def test_crawl_rows_keeps_failed_attempts_with_null_raw(tmp_path):
    _manifest(tmp_path, [{
        "facility_id": "VF-9", "name": "Down", "url": "https://down.test",
        "fetched_at": "2026-06-15T00:00:00+00:00", "status": "fetch_error",
        "error": "dns fail",
    }])
    rows = load_crawl.crawl_rows(tmp_path)
    assert len(rows) == 1
    row = dict(zip(load_crawl._CRAWL_COLS, rows[0]))
    assert row["status"] == "fetch_error"
    assert row["error"] == "dns fail"
    assert row["raw_html"] is None
    assert row["raw_text"] is None


def test_crawl_rows_skips_records_without_url(tmp_path):
    _manifest(tmp_path, [{"facility_id": "VF-1", "status": "skipped"}])
    assert load_crawl.crawl_rows(tmp_path) == []


def test_crawl_rows_missing_manifest_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="manifest"):
        load_crawl.crawl_rows(tmp_path)


# --------------------------------------------------------------- _load
class _FakeCursor:
    def __init__(self, rowcount):
        self._rowcount = rowcount
        self.executed_sql = None
        self.executed_rows = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def executemany(self, sql, rows):
        self.executed_sql = sql
        self.executed_rows = list(rows)
        self.rowcount = self._rowcount


class _FakeConn:
    def __init__(self, rowcount):
        self.cursor_obj = _FakeCursor(rowcount)
        self.committed = False

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.committed = True


def test_load_inserts_rows_and_commits():
    conn = _FakeConn(rowcount=2)
    rows = [("a",) * len(load_crawl._CRAWL_COLS), ("b",) * len(load_crawl._CRAWL_COLS)]
    inserted = load_crawl._load(conn, "bronze", rows)

    assert inserted == 2
    assert conn.committed is True
    assert "ON CONFLICT (crawl_id) DO NOTHING" in conn.cursor_obj.executed_sql
    assert "bronze.facility_web_crawl" in conn.cursor_obj.executed_sql
    assert conn.cursor_obj.executed_rows == rows


def test_load_empty_rows_is_noop():
    conn = _FakeConn(rowcount=0)
    assert load_crawl._load(conn, "bronze", []) == 0
    assert conn.committed is False  # never opened a cursor


def test_load_falls_back_to_len_when_rowcount_unavailable():
    # Some drivers report -1 for executemany; the loader falls back to len(rows).
    conn = _FakeConn(rowcount=-1)
    rows = [("a",) * len(load_crawl._CRAWL_COLS)]
    assert load_crawl._load(conn, "bronze", rows) == 1
