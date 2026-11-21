"""Unit tests for website URL backfill tiered matching."""
from __future__ import annotations

from src.backfill_website_urls import (
    _RefRow,
    _VirtueRow,
    _tiered_match,
)


def test_tiered_match_prefers_exact_name_over_brand():
    virtue = _VirtueRow(
        facility_id="v1",
        name="Apollo Hospitals Greams Road",
        district="Chennai",
        state="Tamil Nadu",
        match_name="apollo greams road",
        brand="apollo greams",
    )
    refs = [
        _RefRow("nabh", "https://brand-only.example", "apollo", "apollo", "Chennai", "Tamil Nadu", 2),
        _RefRow("nabh", "https://exact.example", "apollo greams road", "apollo greams", "Chennai", "Tamil Nadu", 2),
    ]
    match = _tiered_match(virtue, refs)
    assert match is not None
    assert match.website_url == "https://exact.example"


def test_tiered_match_skips_other_state():
    virtue = _VirtueRow(
        facility_id="v1",
        name="Fortis Hospital",
        district="Gurgaon",
        state="Haryana",
        match_name="fortis",
        brand="fortis",
    )
    refs = [
        _RefRow("nabh", "https://fortis.example", "fortis", "fortis", "Mumbai", "Maharashtra", 2),
    ]
    assert _tiered_match(virtue, refs) is None
