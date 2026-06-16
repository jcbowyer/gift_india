"""HTML / public-portal scraping helpers for NHPR (no integrator API token).

The NHPR web app at ``nhpr.abdm.gov.in`` calls the same ``facilitySearch`` and
``facilityDetail`` JSON endpoints the integrator APIs use, but from the browser
without a Bearer token. This module adds browser-like headers and HTML fallbacks
when those XHR calls are blocked or incomplete.
"""
from __future__ import annotations

import json
import re
from typing import Any

import requests
from bs4 import BeautifulSoup
from loguru import logger

NHPR_PORTAL = "https://nhpr.abdm.gov.in"
PORTAL_HOME = f"{NHPR_PORTAL}/home"

# Candidate public detail routes used by the NHPR SPA (tried in order).
DETAIL_PAGE_TEMPLATES = (
    "/hfr/facility-profile/{facility_id}",
    "/hfr/facility-details/{facility_id}",
    "/facility/detail/{facility_id}",
    "/search/facility/{facility_id}",
)

# Label fragments on the public facility profile → canonical bed column.
_BED_LABEL_MAP: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"total\s*(no\.?|number)?\s*of\s*beds", re.I), "total_beds"),
    (re.compile(r"ipd\s*beds?\s*with\s*oxygen", re.I), "ipd_beds_with_oxygen"),
    (re.compile(r"ipd\s*beds?\s*without\s*oxygen", re.I), "ipd_beds_without_oxygen"),
    (re.compile(r"icu\s*beds?\s*with\s*ventilators?", re.I), "icu_beds_with_ventilators"),
    (re.compile(r"icu\s*beds?\s*without\s*ventilators?", re.I), "icu_beds_without_ventilators"),
    (re.compile(r"hdu\s*beds?\s*with\s*ventilators?", re.I), "hdu_beds_with_ventilators"),
    (re.compile(r"hdu\s*beds?\s*without\s*ventilators?", re.I), "hdu_beds_without_ventilators"),
    (re.compile(r"hdu\s*beds?\s*with\s*functional\s*ventilators?", re.I),
     "hdu_beds_with_functional_ventilators"),
    (re.compile(r"day\s*care\s*beds?\s*with\s*oxygen", re.I), "day_care_beds_with_oxygen"),
    (re.compile(r"day\s*care\s*beds?\s*without\s*oxygen", re.I), "day_care_beds_without_oxygen"),
    (re.compile(r"dental\s*chairs?", re.I), "dental_chairs"),
    (re.compile(r"total\s*(no\.?|number)?\s*of\s*ventilators?", re.I), "total_ventilators"),
)

_FACILITY_ID_RE = re.compile(r"\bIN\d{10}\b")


def portal_headers(*, referer: str | None = None) -> dict[str, str]:
    """Browser-like headers for NHPR public XHR (no Authorization)."""
    return {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-IN,en;q=0.9",
        "Content-Type": "application/json",
        "Origin": NHPR_PORTAL,
        "Referer": referer or PORTAL_HOME,
    }


def extract_embedded_json(html: str) -> list[dict[str, Any]]:
    """Pull JSON objects embedded in SPA script tags (Angular / Next bootstrap)."""
    found: list[dict[str, Any]] = []
    for match in re.finditer(
        r"<script[^>]*>(.*?)</script>", html, flags=re.I | re.S,
    ):
        body = match.group(1).strip()
        if not body or "facility" not in body.lower():
            continue
        for blob in re.findall(r"\{[^{}]*facility[Ii]d[^{}]*\}", body):
            try:
                obj = json.loads(blob)
                if isinstance(obj, dict):
                    found.append(obj)
            except json.JSONDecodeError:
                continue
        for marker in ("window.__INITIAL_STATE__", "window.__NUXT__", "ng-state"):
            if marker in body:
                eq = body.split("=", 1)
                if len(eq) == 2:
                    try:
                        obj = json.loads(eq[1].rstrip(";"))
                        if isinstance(obj, dict):
                            found.append(obj)
                    except json.JSONDecodeError:
                        pass
    return found


def _parse_int(text: str) -> int | None:
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else None


def parse_facility_detail_html(html: str) -> dict[str, Any]:
    """Parse a public NHPR facility profile page into a detail-shaped dict."""
    soup = BeautifulSoup(html, "html.parser")
    result: dict[str, Any] = {}

    title = soup.find("h1") or soup.find("h2")
    if title:
        result["facilityName"] = title.get_text(" ", strip=True)

    fid = None
    for node in soup.find_all(string=_FACILITY_ID_RE):
        m = _FACILITY_ID_RE.search(str(node))
        if m:
            fid = m.group(0)
            break
    if fid:
        result["facilityId"] = fid

    # Definition lists and two-column tables: label → value.
    for dl in soup.select("dl"):
        dts = dl.find_all("dt")
        dds = dl.find_all("dd")
        for dt, dd in zip(dts, dds, strict=False):
            label = dt.get_text(" ", strip=True)
            value = dd.get_text(" ", strip=True)
            _apply_label_value(result, label, value)

    for tr in soup.select("tr"):
        cells = tr.find_all(["th", "td"])
        if len(cells) >= 2:
            _apply_label_value(
                result,
                cells[0].get_text(" ", strip=True),
                cells[1].get_text(" ", strip=True),
            )

    # Card / row layouts: "Label" followed by a number sibling.
    for el in soup.find_all(["div", "span", "p", "label"]):
        label = el.get_text(" ", strip=True)
        if not label or len(label) > 80:
            continue
        for pattern, key in _BED_LABEL_MAP:
            if pattern.search(label):
                sibling = el.find_next(["span", "div", "p", "td", "strong"])
                if sibling:
                    val = _parse_int(sibling.get_text(" ", strip=True))
                    if val is not None:
                        result[key] = val

    for embedded in extract_embedded_json(html):
        if embedded.get("facilityId") or embedded.get("facility_id"):
            result.update(embedded)

    return result


def _apply_label_value(result: dict[str, Any], label: str, value: str) -> None:
    low = label.lower()
    if "facility name" in low:
        result["facilityName"] = value
    elif "facility id" in low or low == "hfr id":
        result["facilityId"] = value.strip()
    elif "facility type" in low:
        result["facilityType"] = value
    elif low == "state":
        result["stateName"] = value
    elif low == "district":
        result["districtName"] = value
    elif "pin" in low and "code" in low:
        result["pincode"] = value
    elif low == "address":
        result["address"] = value
    else:
        for pattern, key in _BED_LABEL_MAP:
            if pattern.search(label):
                parsed = _parse_int(value)
                if parsed is not None:
                    result[key] = parsed


def scrape_facility_detail_page(
    session: requests.Session,
    facility_id: str,
    *,
    timeout: float,
) -> dict[str, Any]:
    """Fetch and parse public HTML facility profile pages (no API token)."""
    last_exc: Exception | None = None
    for template in DETAIL_PAGE_TEMPLATES:
        url = f"{NHPR_PORTAL}{template.format(facility_id=facility_id)}"
        try:
            resp = session.get(
                url,
                headers={
                    **portal_headers(referer=PORTAL_HOME),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
                timeout=timeout,
            )
            if resp.status_code != 200 or not resp.text.strip():
                continue
            parsed = parse_facility_detail_html(resp.text)
            if parsed:
                parsed.setdefault("facilityId", facility_id)
                parsed["_scraped_from"] = url
                return parsed
        except requests.RequestException as exc:
            last_exc = exc
            logger.debug("HTML detail {} failed: {}", url, exc)
    if last_exc:
        logger.warning("HTML detail scrape failed for {}: {}", facility_id, last_exc)
    return {}
