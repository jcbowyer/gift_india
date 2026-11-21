"""Unit tests for NABH certificate verification (scope parsing + scoring)."""
from __future__ import annotations

from src.verify_nabh_certificates import (
    build_agent_bricks_parse_sql,
    compute_verification_score,
    elements_to_text,
    extract_facility_name,
    extract_scope_items,
    extract_validity,
    map_scope_to_capabilities,
    parse_certificate_text,
    reference_from_pdf,
    PARSE_METHOD_AGENT_BRICKS,
)

HOSPITAL_SCOPE = """
Scope of Accreditation
H-2011-0109
Clinical Services
x Obstetrics and Gynaecology
x Emergency Medicine
x Critical Care
x Paediatrics
x Orthopedic Surgery including Joint Replacement
Apollo Hospitals
St. Johns Road, Bangalore
Valid from : January 01, 2024
Valid thru  : December 31, 2027
Certificate No. H-2011-0109
"""

DENTAL_SCOPE = """
Scope of Accreditation
D-2020-0112
Clinical Services
x General Dentistry
x Orthodontics and Dentofacial Orthopedics
Divis Dental Specialities and Oral Implant Centre
Nellore - 524004 - Andhra Pradesh
Valid from : September 22, 2023
Valid thru  : September 21, 2026
Certificate No. D-2020-0112
"""


def test_reference_from_pdf():
    from pathlib import Path

    assert reference_from_pdf(Path("H-2021-0846.pdf")) == "H-2021-0846"


def test_extract_scope_items_hospital():
    items = extract_scope_items(HOSPITAL_SCOPE)
    assert "Obstetrics and Gynaecology" in items
    assert "Emergency Medicine" in items
    assert "Critical Care" in items


def test_map_scope_hospital_capabilities():
    items = extract_scope_items(HOSPITAL_SCOPE)
    caps = map_scope_to_capabilities(items)
    assert caps["maternity"]["supports"] is True
    assert caps["emergency"]["supports"] is True
    assert caps["icu"]["supports"] is True
    assert caps["trauma"]["supports"] is True


def test_map_scope_dental_does_not_claim_hospital_caps():
    items = extract_scope_items(DENTAL_SCOPE)
    caps = map_scope_to_capabilities(items)
    assert caps["maternity"]["supports"] is False
    assert caps["icu"]["supports"] is False
    assert caps["trauma"]["supports"] is False


def test_orthodontics_does_not_match_trauma():
    caps = map_scope_to_capabilities(["Orthodontics and Dentofacial Orthopedics"])
    assert caps["trauma"]["supports"] is False


def test_extract_facility_name():
    name = extract_facility_name(HOSPITAL_SCOPE, "H-2011-0109")
    assert name is not None
    assert "Apollo" in name


def test_extract_validity_dates():
    vf, vt = extract_validity(HOSPITAL_SCOPE)
    assert vf is not None and vf.year == 2024
    assert vt is not None and vt.year == 2027


def test_parse_certificate_text_roundtrip():
    from pathlib import Path

    parsed = parse_certificate_text(
        HOSPITAL_SCOPE,
        reference_no="H-2011-0109",
        pdf_path=Path("/tmp/H-2011-0109.pdf"),
        parse_method="test",
    )
    assert parsed.reference_no == "H-2011-0109"
    assert parsed.parsed_capabilities["maternity"]["supports"] is True
    assert len(parsed.scope_items) >= 4


def test_compute_verification_score_corroborated():
    score, signal = compute_verification_score(
        certificate_supports=True,
        virtue_claimed=True,
        nabh_match_confidence=0.85,
        splink_match_probability=0.92,
    )
    assert signal == "corroborated"
    assert score >= 0.75


def test_compute_verification_score_contradicted():
    score, signal = compute_verification_score(
        certificate_supports=False,
        virtue_claimed=True,
        nabh_match_confidence=0.70,
        splink_match_probability=0.80,
    )
    assert signal == "contradicted"
    assert score < 0.75


def test_compute_verification_score_unverified_low_confidence():
    _score, signal = compute_verification_score(
        certificate_supports=False,
        virtue_claimed=False,
        nabh_match_confidence=0.0,
        splink_match_probability=0.0,
    )
    assert signal == "unverified"


def test_elements_to_text_flattens_parse_document_elements():
    elements = [
        {"type": "section_header", "content": "Clinical Services"},
        {"type": "text", "content": "x Obstetrics and Gynaecology"},
        {"type": "figure", "content": "ignored"},
    ]
    text = elements_to_text(elements)
    assert "Clinical Services" in text
    assert "Obstetrics" in text


def test_structured_extract_rejects_date_line_as_facility_name():
    from pathlib import Path

    structured = {
        "facility_name": "Date of Previous Cycle",
        "scope_items": [],
        "reference_no": "D-2020-0103",
    }
    parsed = parse_certificate_text(
        DENTAL_SCOPE,
        reference_no="D-2020-0103",
        pdf_path=Path("/tmp/D-2020-0103.pdf"),
        parse_method=PARSE_METHOD_AGENT_BRICKS,
        structured=structured,
    )
    assert parsed.nabh_name is not None
    assert "Date of Previous" not in (parsed.nabh_name or "")
    assert len(parsed.scope_items) >= 2

    sql = build_agent_bricks_parse_sql("/Volumes/gift_india/bronze/nabh_certificates")
    assert "ai_parse_document" in sql
    assert "ai_extract" in sql
    assert "READ_FILES" in sql
    assert "map('version', '2.0')" in sql
    assert "scope_items" in sql
