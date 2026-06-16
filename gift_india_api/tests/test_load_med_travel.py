"""Unit tests for the Medical Value Travel (MVT) bronze ingestion.

Covers the dataset -> bronze row mapping (list flattening, type coercion, the
entity-resolution keys shared with the JCI seed), the cached-download path, and
the upsert column contract — all with fakes (no real network or Postgres).
"""
from __future__ import annotations

import json
from pathlib import Path

from src import load_med_travel


_DATASET = {
    "hospitals": [
        {
            "id": "H001",
            "name": "Apollo Hospitals, Greams Road",
            "hospital_chain": "Apollo Hospitals",
            "city": "Chennai",
            "state": "Tamil Nadu",
            "tier": 1,
            "international_patient_program": "full",
            "specialties": ["cardiac_surgery", "oncology"],
            "countries_served": ["Bangladesh", "Nigeria"],
            "has_ipc": True,
            "accreditation": ["NABH", "JCI"],
            "avg_cost_index": "medium",
            "beds": 560,
            "established_year": 1983,
            "international_patients_annually": 18000,
            "contact": {
                "phone": "+91-44-28293333",
                "email": "international@apollohospitals.com",
                "website": "https://www.apollohospitals.com",
            },
        },
        # Missing id -> skipped (no stable primary key).
        {"name": "No Id Hospital", "city": "Pune"},
        # Duplicate id -> only the first is kept.
        {"id": "H001", "name": "Apollo Dupe"},
    ],
    "treatments": [{"irrelevant": True}],  # other top-level arrays are ignored
}


def test_build_records_maps_and_flattens():
    records = load_med_travel.build_records(_DATASET, collected_at="2026-04-27T00:00:00+00:00")
    assert len(records) == 1
    r = records[0]
    assert r["mvt_id"] == "H001"
    # List-valued source fields become pipe-delimited strings.
    assert r["specialties"] == "cardiac_surgery|oncology"
    assert r["countries_served"] == "Bangladesh|Nigeria"
    assert r["accreditation"] == "NABH|JCI"
    # Nested contact is flattened.
    assert r["phone"] == "+91-44-28293333"
    assert r["website_url"] == "https://www.apollohospitals.com"
    # Entity-resolution keys match the JCI normalization (brand + qualifier);
    # brand_key keeps only the first two significant tokens.
    assert r["match_name"] == "apollo greams road"
    assert r["brand_key"] == "apollo greams"
    assert r["has_ipc"] is True
    assert r["tier"] == 1
    assert r["data_source"] == "mvt"
    assert r["collected_at"] == "2026-04-27T00:00:00+00:00"


def test_build_records_skips_missing_id_and_dedupes():
    records = load_med_travel.build_records(_DATASET)
    ids = [r["mvt_id"] for r in records]
    assert ids == ["H001"]  # missing-id and duplicate rows dropped


def test_record_keys_match_upsert_columns():
    records = load_med_travel.build_records(_DATASET)
    assert set(records[0]) == set(load_med_travel._COLS)


def test_pipe_handles_strings_and_empties():
    assert load_med_travel._pipe(None) == ""
    assert load_med_travel._pipe([]) == ""
    assert load_med_travel._pipe(["a", " b ", ""]) == "a|b"
    assert load_med_travel._pipe("already|piped") == "already|piped"


def test_int_coerces_and_tolerates_garbage():
    assert load_med_travel._int("560") == 560
    assert load_med_travel._int(None) is None
    assert load_med_travel._int("n/a") is None


def test_fetch_uses_cache_without_network(monkeypatch, tmp_path):
    cached = tmp_path / "mvt_dataset.json"
    cached.write_text(json.dumps(_DATASET), encoding="utf-8")
    monkeypatch.setattr(load_med_travel, "DATA_DIR", tmp_path)
    monkeypatch.setattr(load_med_travel, "RAW_PATH", cached)

    def _boom(*a, **k):  # network must not be touched when cached
        raise AssertionError("requests.get should not be called when cached")

    monkeypatch.setattr(load_med_travel.requests, "get", _boom)
    out = load_med_travel.fetch()
    assert out["hospitals"][0]["id"] == "H001"
