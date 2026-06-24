"""Unit tests for the PMJAY hospital scraper and bronze loader."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src import pmjay_scraper
from src.load_pmjay import _PMJAY_COLS, pmjay_rows


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "pmjay"
SAMPLE_HTML = (FIXTURE_DIR / "results" / "23" / "411" / "page_1.html").read_text(
    encoding="utf-8"
)


def test_parse_select_options_reads_state_dropdown():
    html = """
    <select name="searchState">
      <option value="-1">Select State</option>
      <option value="23">Karnataka</option>
      <option value="9">Delhi</option>
    </select>
    """
    options = pmjay_scraper.parse_select_options(html, "searchState")
    assert options == [("23", "Karnataka"), ("9", "Delhi")]


def test_parse_results_html_extracts_hospitals():
    states_lookup = pmjay_scraper.load_states()
    hospitals = pmjay_scraper.parse_results_html(
        SAMPLE_HTML,
        state_name="Karnataka",
        district_name="Bengaluru Urban",
        state_code="23",
        district_code="411",
        states_lookup=states_lookup,
        collected_at="2026-06-15T00:00:00+00:00",
    )
    assert len(hospitals) == 2
    assert hospitals[0].pmjay_name == "Victoria Hospital"
    assert hospitals[0].hospital_type == "Public"
    assert hospitals[0].state == "Karnataka"
    assert hospitals[0].district == "Bengaluru Urban"
    assert hospitals[0].specialties == "General Medicine|General Surgery"
    assert hospitals[0].specialties_upgraded == "Cardiology"
    assert hospitals[0].pmjay_state_code == "23"
    assert hospitals[0].pmjay_district_code == "411"
    assert hospitals[0].data_source == "pmjay"


def test_build_search_params_includes_readonly_flag():
    params = pmjay_scraper.build_search_params(
        state_code="23", district_code="411", page_no=2,
    )
    assert params["actionFlag"] == "ViewRegisteredHosptlsNew"
    assert params["search"] == "Y"
    assert params["appReadOnly"] == "Y"
    assert params["pageNo"] == "2"
    assert params["searchState"] == "23"
    assert params["searchDistrict"] == "411"


def test_collect_fixture_mode_writes_bronze_pmjay_json(tmp_path: Path):
    summary = pmjay_scraper.collect(
        out_dir=tmp_path,
        fixture_dir=FIXTURE_DIR,
        state_filter="Karnataka",
        max_districts=1,
    )
    assert summary.total == 2
    records_path = tmp_path / "facilities_pmjay.json"
    assert records_path.exists()
    records = json.loads(records_path.read_text(encoding="utf-8"))
    assert {r["pmjay_name"] for r in records} == {
        "Victoria Hospital", "Manipal Hospital",
    }
    assert (tmp_path / "manifest.json").exists()
    assert (tmp_path / "state_districts.json").exists()


def test_pmjay_rows_maps_json_to_tuples(tmp_path: Path):
    pmjay_scraper.collect(
        out_dir=tmp_path,
        fixture_dir=FIXTURE_DIR,
        state_filter="Karnataka",
        max_districts=1,
    )
    rows = pmjay_rows(tmp_path)
    assert len(rows) == 2
    name_idx = _PMJAY_COLS.index("pmjay_name")
    assert rows[0][name_idx] in {"Victoria Hospital", "Manipal Hospital"}


def test_pmjay_rows_missing_file_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="facilities_pmjay.json"):
        pmjay_rows(tmp_path)
