"""Unit tests for the ABDM model-facility scraper and bronze loader."""
from __future__ import annotations

import json
from pathlib import Path

from src import abdm_scraper, load_abdm

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "abdm"


def test_normalize_lookup_collapses_aiims_alias():
    assert abdm_scraper._normalize_lookup("AIIMS Jammu") == abdm_scraper._normalize_lookup(
        "All India Institute of Medical Sciences (AIIMS) Jammu"
    )


def test_merge_records_combines_model_hpr_and_hrl():
    records = abdm_scraper._merge_records(
        model_names=["City Model Hospital"],
        hpr_rows=[
            {
                "hospitalId": "IN0710000999",
                "hospitalName": "City Model Hospital",
                "origin": "District Hospital",
                "status": "Ongoing",
                "value": "10",
                "value2": "20",
                "value3": "30",
                "hprTotal": "8",
                "linkedCount": "15",
                "hidCount": "23",
            }
        ],
        hrl_rows=[
            {
                "hospitalName": "City Model Hospital",
                "linkedCount": "1234",
                "state": "Delhi",
                "districtName": "New Delhi",
            }
        ],
        collected_at="2026-06-17T00:00:00+00:00",
    )
    assert len(records) == 1
    rec = records[0]
    assert rec["abdm_facility_id"] == "IN0710000999"
    assert rec["hfr_id"] == "IN0710000999"
    assert rec["is_model_abdm_facility"] is True
    assert rec["declared_doctors"] == 10
    assert rec["verified_hpr_total"] == 23
    assert rec["hrl_linked_count"] == 1234
    assert rec["state"] == "Delhi"


def test_collect_fixture_mode_writes_facilities_abdm_json(tmp_path: Path):
    summary = abdm_scraper.collect(out_dir=tmp_path, fixture_dir=FIXTURE_DIR)
    assert summary.total == 2
    records = json.loads((tmp_path / "facilities_abdm.json").read_text(encoding="utf-8"))
    assert {r["facility_name"] for r in records} == {"Alpha Hospital", "Beta Clinic"}
    assert all(r["data_source"] == "abdm" for r in records)


def test_abdm_rows_reads_fixture_json(tmp_path: Path):
    abdm_scraper.collect(out_dir=tmp_path, fixture_dir=FIXTURE_DIR)
    rows = load_abdm.abdm_rows(tmp_path)
    assert len(rows) == 2
    assert len(rows[0]) == len(load_abdm._COLS)
