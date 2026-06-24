"""Web scraper for the NHPR / HFR public facility directory (no API token required).

Scrapes the same JSON endpoints the NHPR portal uses (``facilitySearch``,
``facilityDetail``) with browser-like headers — no integrator Bearer token.
Optional ``ABDM_CLIENT_ID`` / ``ABDM_CLIENT_SECRET`` are only used when present.

Public endpoints (production)::

    GET  /nhpr/v4/master/lgd/states
    POST /nhpr/v4/search/facility/facilitySearch
    POST /nhpr/v4/search/facility/facilityDetail

When XHR responses are incomplete, falls back to parsing the public HTML
facility profile pages (see ``nhpr_web``).
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from loguru import logger

from .nhpr_web import portal_headers, scrape_facility_detail_page

NHPR_BASE = os.environ.get("ABDM_NHPR_BASE", "https://nhpr.abdm.gov.in").rstrip("/")
LEGACY_HFR_BASE = os.environ.get(
    "ABDM_HFR_BASE", "https://facility.abdm.gov.in"
).rstrip("/")

SESSION_PATH = os.environ.get("ABDM_SESSION_PATH", "/nhpr/v4/auth/sessions")
LGD_STATES_PATH = os.environ.get("ABDM_LGD_STATES_PATH", "/nhpr/v4/master/lgd/states")
SEARCH_PATH = os.environ.get(
    "ABDM_FACILITY_SEARCH_PATH", "/nhpr/v4/search/facility/facilitySearch"
)
DETAIL_PATH = os.environ.get(
    "ABDM_FACILITY_DETAIL_PATH", "/nhpr/v4/search/facility/facilityDetail"
)

LEGACY_SEARCH_PATH = "/FacilityManagement/v1.5/facility/search"
LEGACY_LGD_STATES_PATH = "/FacilityManagement/v1.5/facility/lgd/states"

BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
DEFAULT_TIMEOUT = float(os.environ.get("ABDM_TIMEOUT", "45"))
DEFAULT_RETRIES = int(os.environ.get("ABDM_RETRIES", "4"))
DEFAULT_DELAY = float(os.environ.get("ABDM_DELAY", "0.35"))

# HFR master-data facility-type codes that denote a hospital (not clinic/PHC).
HOSPITAL_TYPE_CODES = frozenset({"5", "8", "9", "10", "12", "13", "14", "15"})
HOSPITAL_TYPE_RE = re.compile(r"\bhospital\b", re.I)

_LGD_FALLBACK = Path(__file__).with_name("nhpr_lgd_states.json")

# Bed / infrastructure keys returned by facilityDetail (camelCase or snake_case).
_BED_ALIASES: dict[str, tuple[str, ...]] = {
    "total_beds": (
        "totalNumberOfBeds", "total_number_of_beds", "totalBeds", "beds",
    ),
    "ipd_beds_with_oxygen": (
        "countIpdBedsWithOxygen", "count_ipd_beds_with_oxygen",
    ),
    "ipd_beds_without_oxygen": (
        "countIpdBedsWithoutOxygen", "count_ipd_beds_without_oxygen",
    ),
    "icu_beds_with_ventilators": (
        "countIcuBedsWithVentilators", "count_icu_beds_with_ventilators",
    ),
    "icu_beds_without_ventilators": (
        "countIcuBedsWithoutVentilators", "count_icu_beds_without_ventilators",
    ),
    "hdu_beds_with_ventilators": (
        "countHduBedsWithVentilators", "count_hdu_beds_with_ventilators",
    ),
    "hdu_beds_without_ventilators": (
        "countHduBedsWithoutVentilators", "count_hdu_beds_without_ventilators",
    ),
    "hdu_beds_with_functional_ventilators": (
        "countHduBedsWithFunctionalVentilators",
        "count_hdu_beds_with_functional_ventilators",
    ),
    "day_care_beds_with_oxygen": (
        "countDayCareBedsWithOxygen", "count_day_care_beds_with_oxygen",
    ),
    "day_care_beds_without_oxygen": (
        "countDayCareBedsWithoutOxygen", "count_day_care_beds_without_oxygen",
    ),
    "dental_chairs": ("countDentalChairs", "count_dental_chairs"),
    "total_ventilators": (
        "totalNumberOfVentilators", "total_number_of_ventilators",
    ),
}


@dataclass
class NhprConfig:
    client_id: str | None = None
    client_secret: str | None = None
    cm_id: str = "abdm"
    nhpr_base: str = NHPR_BASE
    legacy_base: str = LEGACY_HFR_BASE
    timeout: float = DEFAULT_TIMEOUT
    retries: int = DEFAULT_RETRIES
    delay: float = DEFAULT_DELAY
    prefer_legacy: bool = False

    @classmethod
    def from_env(cls) -> NhprConfig:
        return cls(
            client_id=os.environ.get("ABDM_CLIENT_ID"),
            client_secret=os.environ.get("ABDM_CLIENT_SECRET"),
            cm_id=os.environ.get("ABDM_CM_ID", "abdm"),
            nhpr_base=os.environ.get("ABDM_NHPR_BASE", NHPR_BASE),
            legacy_base=os.environ.get("ABDM_HFR_BASE", LEGACY_HFR_BASE),
            timeout=float(os.environ.get("ABDM_TIMEOUT", str(DEFAULT_TIMEOUT))),
            retries=int(os.environ.get("ABDM_RETRIES", str(DEFAULT_RETRIES))),
            delay=float(os.environ.get("ABDM_DELAY", str(DEFAULT_DELAY))),
            prefer_legacy=os.environ.get("ABDM_PREFER_LEGACY", "").lower()
            in {"1", "true", "yes"},
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _request_id() -> str:
    return str(uuid.uuid4())


def _iso_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _walk(obj: Any):
    """Yield every dict node in a nested JSON structure."""
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for item in obj:
            yield from _walk(item)


def _first_key(d: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def extract_bed_counts(detail: dict[str, Any] | None) -> dict[str, int | None]:
    """Pull normalized bed / ventilator counts from a facilityDetail payload."""
    if not detail:
        return {k: None for k in _BED_ALIASES}
    found: dict[str, int | None] = {k: None for k in _BED_ALIASES}
    for node in _walk(detail):
        for canonical, aliases in _BED_ALIASES.items():
            if found[canonical] is not None:
                continue
            for alias in aliases:
                if alias in node:
                    found[canonical] = _as_int(node[alias])
                    break
    return found


def is_hospital_record(record: dict[str, Any]) -> bool:
    """True when the search/detail record represents a hospital facility type."""
    type_code = str(
        _first_key(record, "facilityTypeCode", "facility_type_code") or ""
    ).strip()
    type_name = str(
        _first_key(record, "facilityType", "facility_type") or ""
    ).strip()
    if type_code in HOSPITAL_TYPE_CODES:
        return True
    if HOSPITAL_TYPE_RE.search(type_name):
        return True
    # Dental hospitals are hospitals; exclude plain dental clinics.
    if re.search(r"\bdental\s+hospital\b", type_name, re.I):
        return True
    if re.search(r"\bclinic\b", type_name, re.I) and "hospital" not in type_name.lower():
        return False
    return False


def flatten_facility(
    search: dict[str, Any] | None,
    detail: dict[str, Any] | None,
    *,
    collected_at: str,
    match_name: str,
    brand_key: str,
) -> dict[str, Any]:
    """Merge search + detail into a bronze-ready flat record."""
    src = {}
    if search:
        src.update(search)
    if detail:
        # Detail wins on conflicts — it is the authoritative snapshot.
        facility = detail.get("facility") if isinstance(detail.get("facility"), dict) else None
        if facility:
            src.update(facility)
        src.update({k: v for k, v in detail.items() if k != "facility"})

    beds = extract_bed_counts(detail or src)
    facility_id = _first_key(src, "facilityId", "facility_id")
    if not facility_id:
        raise ValueError("facility record is missing facilityId")

    specialities = src.get("specialities") or src.get("specialitiesList") or []
    if isinstance(specialities, list):
        spec_text = "|".join(
            s if isinstance(s, str) else str(s.get("code") or s.get("value") or s)
            for s in specialities
        )
    else:
        spec_text = str(specialities) if specialities else ""

    imaging = src.get("imagingServices") or src.get("imaging_services") or []
    diagnostic = src.get("diagnosticServices") or src.get("diagnostic_services") or []

    def _svc_text(val: Any) -> str:
        if isinstance(val, list):
            return "|".join(
                x if isinstance(x, str) else str(x.get("code") or x.get("value") or x)
                for x in val
            )
        return str(val) if val else ""

    return {
        "nhpr_facility_id": facility_id,
        "facility_name": _first_key(src, "facilityName", "facility_name") or "",
        "facility_status": _first_key(src, "facilityStatus", "facility_status"),
        "facility_type": _first_key(src, "facilityType", "facility_type"),
        "facility_type_code": _first_key(src, "facilityTypeCode", "facility_type_code"),
        "ownership": _first_key(src, "ownership", "ownershipName"),
        "ownership_code": _first_key(src, "ownershipCode", "ownership_code"),
        "system_of_medicine": _first_key(src, "systemOfMedicine", "system_of_medicine"),
        "system_of_medicine_code": _first_key(
            src, "systemOfMedicineCode", "system_of_medicine_code"
        ),
        "state_name": _first_key(src, "stateName", "state_name"),
        "state_lgd_code": _first_key(src, "stateLGDCode", "state_lgd_code"),
        "district_name": _first_key(src, "districtName", "district_name"),
        "district_lgd_code": _first_key(src, "districtLGDCode", "district_lgd_code"),
        "sub_district_name": _first_key(src, "subDistrictName", "sub_district_name"),
        "sub_district_lgd_code": _first_key(
            src, "subDistrictLGDCode", "sub_district_lgd_code"
        ),
        "village_city_town_name": _first_key(
            src, "villageCityTownName", "village_city_town_name"
        ),
        "address": _first_key(src, "address", "addressLine1", "address_line_1"),
        "pincode": _first_key(src, "pincode", "pinCode"),
        "latitude": _as_float(_first_key(src, "latitude", "lat")),
        "longitude": _as_float(_first_key(src, "longitude", "lng", "lon")),
        "website_url": _first_key(src, "websiteLink", "website_url", "website"),
        "phone": _first_key(
            src, "facilityContactNumber", "facility_contact_number", "phone"
        ),
        "email": _first_key(src, "facilityEmailId", "facility_email_id", "email"),
        **beds,
        "specialities": spec_text,
        "imaging_services": _svc_text(imaging),
        "diagnostic_services": _svc_text(diagnostic),
        "match_name": match_name,
        "brand_key": brand_key,
        "detail_json": detail,
        "search_json": search,
        "verified_on_portal": True,
        "source": "nhpr_facility_detail",
        "source_url": f"{NHPR_BASE}{DETAIL_PATH}",
        "data_source": "nhpr",
        "collected_at": collected_at,
    }


class NhprClient:
    """Public-portal web scraper for NHPR / HFR (token optional)."""

    def __init__(self, config: NhprConfig | None = None, session: requests.Session | None = None):
        self.config = config or NhprConfig.from_env()
        self.session = session or requests.Session()
        self.session.headers.setdefault("User-Agent", BROWSER_USER_AGENT)
        self.session.headers.setdefault("Accept", "application/json")
        self._access_token: str | None = None
        self._token_expiry: float = 0.0
        self._use_legacy = self.config.prefer_legacy

    def _portal_headers(self, *, referer: str | None = None) -> dict[str, str]:
        headers = portal_headers(referer=referer)
        headers["REQUEST-ID"] = _request_id()
        headers["TIMESTAMP"] = _iso_timestamp()
        headers["X-CM-ID"] = self.config.cm_id
        token = self._ensure_token()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _ensure_token(self) -> str | None:
        if not self.config.client_id or not self.config.client_secret:
            return None
        if self._access_token and time.time() < self._token_expiry - 60:
            return self._access_token
        url = f"{self.config.nhpr_base}{SESSION_PATH}"
        body = {
            "clientId": self.config.client_id,
            "clientSecret": self.config.client_secret,
            "grantType": "client_credentials",
        }
        resp = self._post_raw(url, body, auth=False)
        token = resp.get("accessToken") or resp.get("access_token")
        if not token:
            raise RuntimeError(f"NHPR session response missing accessToken: {resp!r}")
        expires = resp.get("expiresIn") or resp.get("expires_in") or 3600
        self._access_token = token
        self._token_expiry = time.time() + float(expires)
        return token

    def _post_raw(
        self,
        url: str,
        body: dict[str, Any] | None,
        *,
        auth: bool = True,
        method: str = "POST",
    ) -> dict[str, Any]:
        headers = self._portal_headers() if auth else self._portal_headers()
        last_exc: Exception | None = None
        for attempt in range(1, self.config.retries + 1):
            try:
                if method.upper() == "GET":
                    resp = self.session.get(
                        url, headers=headers, timeout=self.config.timeout
                    )
                else:
                    resp = self.session.post(
                        url,
                        headers=headers,
                        data=json.dumps(body or {}),
                        timeout=self.config.timeout,
                    )
                resp.raise_for_status()
                if not resp.content:
                    return {}
                return resp.json()
            except (requests.RequestException, ValueError) as exc:
                last_exc = exc
                wait = min(2 ** attempt, 30)
                logger.warning(
                    "{} {} attempt {}/{} failed ({}); retry in {}s",
                    method, url, attempt, self.config.retries, exc, wait,
                )
                time.sleep(wait)
        raise RuntimeError(f"{method} {url} failed after {self.config.retries} attempts: {last_exc}")

    def fetch_lgd_states(self) -> list[dict[str, Any]]:
        """Return LGD state list — live portal XHR when reachable, else bundled gazetteer."""
        data: Any = None
        try:
            if self._use_legacy:
                data = self._post_raw(
                    f"{self.config.legacy_base}{LEGACY_LGD_STATES_PATH}",
                    None,
                    method="GET",
                )
            else:
                try:
                    data = self._post_raw(
                        f"{self.config.nhpr_base}{LGD_STATES_PATH}",
                        None,
                        method="GET",
                    )
                except RuntimeError:
                    logger.warning("NHPR LGD states failed; trying legacy HFR endpoint")
                    data = self._post_raw(
                        f"{self.config.legacy_base}{LEGACY_LGD_STATES_PATH}",
                        None,
                        method="GET",
                    )
                    self._use_legacy = True

            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                for key in ("states", "data", "lgdStates"):
                    if isinstance(data.get(key), list):
                        return data[key]
        except RuntimeError as exc:
            logger.warning("Live LGD state fetch failed ({}); using bundled gazetteer", exc)

        if _LGD_FALLBACK.exists():
            return json.loads(_LGD_FALLBACK.read_text(encoding="utf-8"))
        raise RuntimeError(f"Unexpected LGD states payload: {type(data)}")

    def search_facilities(
        self,
        *,
        ownership_code: str,
        state_lgd_code: str,
        facility_name: str,
        district_lgd_code: str = "",
        page: int = 1,
        results_per_page: int = 100,
    ) -> dict[str, Any]:
        body = {
            "ownershipCode": ownership_code,
            "stateLGDCode": state_lgd_code,
            "districtLGDCode": district_lgd_code or "",
            "subDistrictLGDCode": "",
            "pincode": "",
            "facilityName": facility_name,
            "facilityId": "",
            "page": page,
            "resultsPerPage": results_per_page,
        }
        if self._use_legacy:
            url = f"{self.config.legacy_base}{LEGACY_SEARCH_PATH}"
        else:
            url = f"{self.config.nhpr_base}{SEARCH_PATH}"
        try:
            return self._post_raw(url, body)
        except RuntimeError:
            if self._use_legacy:
                raise
            logger.warning("NHPR facilitySearch failed; trying legacy HFR search")
            self._use_legacy = True
            return self._post_raw(
                f"{self.config.legacy_base}{LEGACY_SEARCH_PATH}", body
            )

    def facility_detail(self, facility_id: str) -> dict[str, Any]:
        body = {"facilityId": facility_id}
        detail: dict[str, Any] = {}
        if not self._use_legacy:
            url = f"{self.config.nhpr_base}{DETAIL_PATH}"
            try:
                detail = self._post_raw(url, body)
            except RuntimeError:
                logger.warning(
                    "NHPR facilityDetail XHR failed for {}; trying legacy + HTML",
                    facility_id,
                )
                self._use_legacy = True

        if not detail:
            try:
                resp = self._post_raw(
                    f"{self.config.legacy_base}{LEGACY_SEARCH_PATH}",
                    {
                        "ownershipCode": "P",
                        "stateLGDCode": "",
                        "districtLGDCode": "",
                        "subDistrictLGDCode": "",
                        "pincode": "",
                        "facilityName": "",
                        "facilityId": facility_id,
                        "page": 1,
                        "resultsPerPage": 1,
                    },
                )
                facilities = resp.get("facilities") or []
                if facilities:
                    detail = {"facility": facilities[0], **facilities[0]}
                elif resp:
                    detail = resp
            except RuntimeError:
                detail = {}

        if not detail or not extract_bed_counts(detail).get("total_beds"):
            html_detail = scrape_facility_detail_page(
                self.session, facility_id, timeout=self.config.timeout,
            )
            if html_detail:
                detail = {**detail, **html_detail}

        return detail

    def iter_search_pages(
        self,
        *,
        ownership_code: str,
        state_lgd_code: str,
        facility_name: str,
        results_per_page: int = 100,
        max_pages: int | None = None,
    ):
        page = 1
        while True:
            payload = self.search_facilities(
                ownership_code=ownership_code,
                state_lgd_code=state_lgd_code,
                facility_name=facility_name,
                page=page,
                results_per_page=results_per_page,
            )
            facilities = payload.get("facilities") or []
            yield page, payload, facilities
            total_pages = int(payload.get("numberOfPages") or payload.get("number_of_pages") or 1)
            if not facilities or page >= total_pages:
                break
            if max_pages is not None and page >= max_pages:
                break
            page += 1
            time.sleep(self.config.delay)
