"""Unit tests for NABH badge / reference programme parsing."""
from __future__ import annotations

from bs4 import BeautifulSoup

from src.nabh_scraper import (
    _program_from_badge_images,
    _program_from_ref,
    _resolve_program,
    _status_from_badge,
    build_portal_certificate_url,
)


def test_program_from_badge_image_ayush():
    assert _program_from_badge_images(["ayush-hos"]) == "AYUSH Hospitals"


def test_program_from_badge_image_emergency():
    assert _program_from_badge_images(["certified-emergency-services"]) == "Emergency Deptt"


def test_program_from_ref_portal_style():
    assert _program_from_ref("SHCO-2025-1339") == "SHCO"
    assert _program_from_ref("PESHCO-2024-0100") == "Entry-Level SHCO"


def test_program_from_ref_empaneled_style():
    assert _program_from_ref("HOS/2025/E2674") == "Hospitals"
    assert _program_from_ref("EYE/2025/C0593") == "Eye Care Organisation"


def test_resolve_program_prefers_cert_then_badge_then_ref():
    cert = "https://portal.nabh.co/Documents/AccreditedList/Hospitals/H-2021-0846.pdf"
    assert _resolve_program(cert, ["ayush-hos"], "HOS/2025/E2674") == "Hospitals"
    assert _resolve_program("#", ["ayush-hos"], "HOS/2025/E2674") == "AYUSH Hospitals"
    assert _resolve_program("#", ["accreditation"], "SHCO-2025-1339") == "SHCO"


def test_status_from_badge_text_and_image():
    html = """
    <div class="hs-col-5">
      <img src="https://nabh.co/wp-content/themes/nabh/assets/images/badges/accreditation.webp"/>
      <span class="badge-icon badge-icon-accredited">
        <span class="certification-icon">Accredited</span>
      </span>
    </div>
    """
    col5 = BeautifulSoup(html, "html.parser").select_one(".hs-col-5")
    assert _status_from_badge(col5) == "Accredited"

    html_cert = """
    <div class="hs-col-5">
      <img src="https://nabh.co/.../Certification-Hospitals-SHCO.webp"/>
    </div>
    """
    col5_cert = BeautifulSoup(html_cert, "html.parser").select_one(".hs-col-5")
    assert _status_from_badge(col5_cert) == "Certified"


def test_build_portal_certificate_url_from_reference():
    url = build_portal_certificate_url("#", "SHCO-2025-1339", "SHCO")
    assert url == (
        "https://portal.nabh.co/Documents/AccreditedList/SHCO/SHCO-2025-1339.pdf"
    )
