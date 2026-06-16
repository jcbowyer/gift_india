"""Unit tests for NHPR client, scraper, and bronze loader."""
from __future__ import annotations

import json
from pathlib import Path

from src import load_nhpr, nhpr_client, nhpr_scraper

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "nhpr"


def test_is_hospital_record_filters_clinics():
    hospital = {"facilityTypeCode": "5", "facilityType": "Hospital"}
    clinic = {"facilityTypeCode": "16", "facilityType": "Dental Clinic"}
    assert nhpr_client.is_hospital_record(hospital)
    assert not nhpr_client.is_hospital_record(clinic)


def test_extract_bed_counts_from_detail():
    detail = json.loads((FIXTURE_DIR / "details" / "IN0710000123.json").read_text())
    beds = nhpr_client.extract_bed_counts(detail)
    assert beds["total_beds"] == 2478
    assert beds["icu_beds_with_ventilators"] == 120
    assert beds["total_ventilators"] == 150


def test_flatten_facility_merges_search_and_detail():
    search = {
        "facilityId": "IN0710000123",
        "facilityName": "All India Institute of Medical Sciences",
        "facilityType": "Hospital",
        "facilityTypeCode": "5",
        "stateName": "DELHI",
    }
    detail = json.loads((FIXTURE_DIR / "details" / "IN0710000123.json").read_text())
    rec = nhpr_client.flatten_facility(
        search,
        detail,
        collected_at="2026-06-15T00:00:00+00:00",
        match_name="aiims",
        brand_key="aiims",
    )
    assert rec["nhpr_facility_id"] == "IN0710000123"
    assert rec["total_beds"] == 2478
    assert rec["specialities"] == "s6|s13"
    assert rec["imaging_services"] == "CT|MRI"


def test_collect_fixture_scrape_filters_hospitals(tmp_path):
    summary = nhpr_scraper.collect(
        out_dir=tmp_path,
        ownership_codes=("G",),
        search_tokens=("hospital",),
        fixture_dir=FIXTURE_DIR,
    )
    assert summary.total == 1
    records = json.loads((tmp_path / "nhpr_hospitals.json").read_text())
    assert len(records) == 1
    assert records[0]["facility_name"].startswith("All India")


def test_parse_facility_detail_html_extracts_beds():
    html = """
    <html><body>
      <h1>City Hospital</h1>
      <p>Facility ID: IN0710000456</p>
      <dl>
        <dt>Total Number of Beds</dt><dd>120</dd>
        <dt>ICU Beds with Ventilators</dt><dd>12</dd>
        <dt>State</dt><dd>Delhi</dd>
      </dl>
    </body></html>
    """
    from src import nhpr_web

    parsed = nhpr_web.parse_facility_detail_html(html)
    assert parsed["facilityName"] == "City Hospital"
    assert parsed["facilityId"] == "IN0710000456"
    assert parsed["total_beds"] == 120
    assert parsed["icu_beds_with_ventilators"] == 12
    assert parsed["stateName"] == "Delhi"


def test_nhpr_rows_match_upsert_columns(tmp_path):
    nhpr_scraper.collect(
        out_dir=tmp_path,
        ownership_codes=("G",),
        search_tokens=("hospital",),
        fixture_dir=FIXTURE_DIR,
    )
    rows = load_nhpr.nhpr_rows(tmp_path)
    assert len(rows) == 1
    assert len(rows[0]) == len(load_nhpr._COLS)
