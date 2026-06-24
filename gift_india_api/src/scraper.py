"""Scrape facility official websites and store the results under ``data/scraped``.

The scraper reads facility records (from the live database when configured, else
the synthetic CSV bundle) and visits the ``website_url`` of every facility that
has one. For each site it stores a raw HTML snapshot plus an extracted JSON of
the useful fields (title, description, emails, phones, address, visible text),
and writes a ``manifest.json`` summarising every scrape attempt. The extracted
fields include the clinical ``specialties`` (and signature treatments) advertised
on the page, plus ``capability_claims`` — the verbatim sentences the site uses to
assert each tracked capability (ICU, Maternity, Emergency, Oncology, Trauma,
NICU), saved as evidence — both detected from curated medical vocabularies.

While the project is in pilot the crawl is **scoped to a handful of districts**
(``CRAWL_REGIONS`` — Mumbai, Delhi, Bengaluru, Lucknow, Jaisalmer); facilities
outside them are skipped. Pass ``--all-districts`` to crawl the whole dataset.

Synthetic demo facilities have an empty ``website_url`` and are skipped — there
are no real sites to fetch. Populate ``website_url`` (from the governed Virtue
Foundation dataset or via ``--input``) to actually scrape.

Output layout — a human-readable hierarchy keyed by geography then facility::

    data/scraped/
    ├── manifest.json                          # one record per facility attempted
    └── <state>/<district>/<facility-name>-<facility_id>/
        ├── page.html                          # raw HTML snapshot
        ├── homepage.png                       # viewport PNG thumbnail of the live page
        ├── homepage.pdf                       # printable PDF of the live page
        └── extracted.json                     # structured fields parsed from the page

e.g. ``data/scraped/tamil-nadu/madurai/aravind-eye-hospital-VF-000123/``. Folder
names are slugified (lowercase, hyphenated) and the leaf keeps the facility id as
a suffix so it stays unique even when two facilities share a name.

Examples
--------
Scrape every facility that has a website (from the configured data source)::

    python -m src.scraper

Scrape a custom list of URLs (CSV with a ``website_url``/``url`` column, or a
``.txt`` with one URL per line)::

    python -m src.scraper --input data/facility_urls.csv

Be polite (slower) and cap the run while testing::

    python -m src.scraper --limit 20 --delay 2.0
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from loguru import logger

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_OUT_DIR = DATA_DIR / "scraped"

USER_AGENT = (
    "GiftIndiaBot/1.0 (+https://github.com/jcbowyer/gift_india; "
    "research scraper for healthcare facility data)"
)
DEFAULT_TIMEOUT = 20.0
DEFAULT_DELAY = 1.0
DEFAULT_RETRIES = 2
MAX_TEXT_CHARS = 20_000
THUMBNAIL_VIEWPORT = {"width": 1280, "height": 720}
THUMBNAIL_SETTLE_MS = 1500

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# Indian numbers (optional +91/0 prefix, 10 digits) and generic 7-15 digit runs.
_PHONE_RE = re.compile(
    r"(?:(?:\+?91[\-\s]?)|0)?(?:\d[\-\s]?){9,14}\d"
)

# Clinical specialities and signature treatments/procedures a hospital site
# advertises. Each canonical label maps to the alias fragments that signal it;
# aliases are matched whole-word, case-insensitively, against the page's visible
# text (title + heading + description + body), so a site listing "Cardiac
# Sciences" or "Angioplasty" yields the canonical "Cardiology" / "Angioplasty".
# Deliberately high-precision — bare words like "heart"/"skin"/"liver" are avoided
# so the field stays clean for the downstream capability matcher. The capability
# keys the navigator reasons about (ICU, emergency, trauma, neonatology, maternity,
# oncology) are mirrored here so a crawl corroborates them.
SPECIALTY_VOCAB: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Cardiology", ("cardiology", "cardiac sciences", "cardiac care", "cardiac centre", "cardiac center", "interventional cardiology")),
    ("Cardiac Surgery", ("cardiac surgery", "cardiothoracic", "ctvs", "heart surgery", "open heart")),
    ("Angioplasty", ("angioplasty", "angiography", "stenting", "stent")),
    ("Bypass Surgery", ("bypass surgery", "cabg", "coronary artery bypass")),
    ("Oncology", ("oncology", "cancer care", "cancer institute", "cancer centre", "cancer center", "oncosurgery")),
    ("Chemotherapy", ("chemotherapy",)),
    ("Radiotherapy", ("radiotherapy", "radiation therapy", "radiation oncology")),
    ("Neurology", ("neurology", "neurosciences", "neuro sciences")),
    ("Neurosurgery", ("neurosurgery", "neuro surgery", "brain surgery")),
    ("Orthopedics", ("orthopedics", "orthopaedics", "orthopedic", "orthopaedic", "bone and joint")),
    ("Joint Replacement", ("joint replacement", "knee replacement", "hip replacement", "arthroplasty")),
    ("Spine Surgery", ("spine surgery", "spinal surgery", "spine care")),
    ("Nephrology", ("nephrology", "renal sciences", "kidney care")),
    ("Dialysis", ("dialysis", "hemodialysis", "haemodialysis")),
    ("Urology", ("urology", "urologist", "uro surgery")),
    ("Gastroenterology", ("gastroenterology", "gastro sciences", "gastrointestinal", "digestive diseases")),
    ("Hepatology", ("hepatology", "liver institute", "liver clinic")),
    ("Pulmonology", ("pulmonology", "pulmonary medicine", "respiratory medicine", "chest medicine")),
    ("Endocrinology", ("endocrinology", "diabetology", "diabetes care")),
    ("Dermatology", ("dermatology", "dermatologist")),
    ("Ophthalmology", ("ophthalmology", "eye care", "eye hospital", "eye institute", "eye centre", "eye center")),
    ("Cataract Surgery", ("cataract",)),
    ("LASIK", ("lasik",)),
    ("ENT", ("ent", "otolaryngology", "otorhinolaryngology", "ear nose throat", "ear nose and throat")),
    ("Obstetrics & Gynaecology", ("gynaecology", "gynecology", "obstetrics", "obgyn")),
    ("Maternity", ("maternity", "childbirth", "birthing", "labour and delivery")),
    ("Pediatrics", ("pediatrics", "paediatrics", "child care")),
    ("Neonatology", ("neonatology", "neonatal", "nicu")),
    ("Fertility / IVF", ("ivf", "fertility", "infertility", "reproductive medicine", "test tube baby", "iui", "icsi")),
    ("Psychiatry", ("psychiatry", "mental health", "psychiatric", "de-addiction")),
    ("Rheumatology", ("rheumatology",)),
    ("Hematology", ("hematology", "haematology")),
    ("Plastic Surgery", ("plastic surgery", "cosmetic surgery", "aesthetic surgery", "reconstructive surgery")),
    ("Vascular Surgery", ("vascular surgery",)),
    ("General Surgery", ("general surgery",)),
    ("Bariatric Surgery", ("bariatric", "obesity surgery", "weight loss surgery")),
    ("Transplant", ("transplant",)),
    ("Dentistry", ("dental", "dentistry", "orthodontics")),
    ("Radiology", ("radiology", "diagnostic imaging")),
    ("Pathology", ("pathology", "laboratory medicine")),
    ("Anesthesiology", ("anesthesiology", "anaesthesiology", "anesthesia", "anaesthesia")),
    ("Physiotherapy", ("physiotherapy", "physical therapy")),
    ("Rehabilitation", ("rehabilitation", "rehab")),
    ("Pain Management", ("pain management", "pain clinic")),
    ("Critical Care", ("critical care", "intensive care", "icu")),
    ("Emergency", ("emergency", "casualty")),
    ("Trauma", ("trauma",)),
    ("Endoscopy", ("endoscopy", "colonoscopy")),
    ("Laparoscopy", ("laparoscopy", "laparoscopic", "minimally invasive surgery")),
    ("Robotic Surgery", ("robotic surgery",)),
)


def _compile_specialty_patterns() -> tuple[tuple[str, re.Pattern[str]], ...]:
    """Compile one whole-word, case-insensitive matcher per canonical speciality."""
    compiled: list[tuple[str, re.Pattern[str]]] = []
    for canonical, aliases in SPECIALTY_VOCAB:
        # Match aliases whole-word; allow flexible inter-word whitespace so
        # "ear   nose throat" / line-wrapped phrases still match.
        alts = "|".join(re.escape(a).replace(r"\ ", r"\s+") for a in aliases)
        compiled.append((canonical, re.compile(rf"\b(?:{alts})\b", re.IGNORECASE)))
    return tuple(compiled)


_SPECIALTY_PATTERNS = _compile_specialty_patterns()

# The six capabilities the navigator tracks (keys match
# gift_india_dbt/seeds/capabilities.csv) → the distinctive page-text terms that
# signal a self-reported claim. A sentence on the official site containing one of
# these terms is a real "claim" about that capability; we save the sentence
# verbatim as evidence. Keep this map in lock-step with the `capability_terms`
# CTE in gift_india_dbt/models/gold/capability_evidence.sql so the scrape and the
# dbt website-text evidence agree on what counts as a mention.
CAPABILITY_CLAIM_TERMS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("icu", ("intensive care", "critical care", "icu", "intensivist", "ventilator", "high dependency unit", "hdu")),
    ("maternity", ("maternity", "obstetric", "gynaec", "labour ward", "labour room", "delivery suite",
                   "antenatal", "birthing", "c-section", "caesarean", "cesarean")),
    ("emergency", ("emergency department", "emergency care", "emergency room", "casualty",
                   "accident and emergency", "resuscitation", "24x7 emergency", "24/7 emergency")),
    ("oncology", ("oncology", "cancer", "chemotherapy", "radiotherapy", "radiation oncology", "tumour", "tumor")),
    ("trauma", ("trauma", "trauma surgery", "orthopaedic", "orthopedic", "fracture")),
    ("nicu", ("nicu", "neonatal", "newborn intensive", "premature baby", "premature newborn")),
)


def _compile_capability_patterns() -> tuple[tuple[str, re.Pattern[str]], ...]:
    """Compile one whole-word, case-insensitive matcher per tracked capability."""
    compiled: list[tuple[str, re.Pattern[str]]] = []
    for capability, terms in CAPABILITY_CLAIM_TERMS:
        alts = "|".join(re.escape(t).replace(r"\ ", r"\s+") for t in terms)
        compiled.append((capability, re.compile(rf"\b(?:{alts})\b", re.IGNORECASE)))
    return tuple(compiled)


_CAPABILITY_PATTERNS = _compile_capability_patterns()

# Sentence boundary on the whitespace-collapsed page text. Many hospital pages are
# menu dumps with few periods, so a "sentence" can be long — claims center a window
# around the matched term (see _claim_snippet) rather than emit the whole run.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
# Bounds for a saved claim snippet (chars). Below the floor it's a bare menu label
# (kept, but it's a weak claim); above the ceiling we window around the term.
CLAIM_MAX_CHARS = 240
MAX_CLAIMS_PER_CAPABILITY = 3


# Pilot coverage — the facility crawl is scoped to these districts while the
# project is in pilot (see README "Coverage" notice). The real entity-resolved
# data has noisy and sometimes swapped district/state values, so each region
# matches when ANY of its tokens appears in EITHER the district or state field.
CRAWL_REGIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Mumbai City / Suburban (Maharashtra)", ("mumbai",)),
    ("New Delhi / Central Delhi (Delhi NCT)", ("delhi",)),
    ("Bengaluru Urban (Karnataka)", ("bengaluru", "bangalore")),
    ("Lucknow (Uttar Pradesh)", ("lucknow",)),
    ("Jaisalmer (Rajasthan)", ("jaisalmer",)),
)
CRAWL_SCOPE_LABEL = "; ".join(name for name, _ in CRAWL_REGIONS)


# Facility types excluded from the deep crawl + downstream analysis. These are the
# small, high-volume primary-care / clinic records in the governed VF dataset that
# rarely carry an informative official website and aren't the surgical, hospital-
# grade facilities the navigator reasons about. Excluding them focuses the crawl on
# the ~6.5K hospital-grade rows. Counts in the real dataset (≈10K facilities):
# "Clinic / Centre" (3,481), "Primary Health Centre" (12), "Community Health
# Centre" (7). Matched case-insensitively against the facility ``type`` field.
EXCLUDED_TYPES: frozenset[str] = frozenset(
    {
        "clinic / centre",
        "primary health centre",
        "community health centre",
    }
)


def _is_excluded_type(ftype: str | None) -> bool:
    """True when a facility's ``type`` is excluded from the deep crawl/analysis."""
    return (ftype or "").strip().lower() in EXCLUDED_TYPES


def _in_crawl_scope(district: str | None, state: str | None) -> bool:
    """True when a facility falls within the pilot crawl districts.

    Region tokens are matched against both fields (lower-cased) because the
    source data sometimes carries the city in ``state`` and the locality in
    ``district``.
    """
    hay = f"{district or ''} {state or ''}".lower()
    return any(tok in hay for _, tokens in CRAWL_REGIONS for tok in tokens)


@dataclass
class ScrapeTarget:
    """A single thing to scrape."""

    facility_id: str
    name: str
    url: str
    state: str = ""
    district: str = ""


@dataclass
class ScrapeRecord:
    """The outcome of one scrape attempt (one row of the manifest)."""

    facility_id: str
    name: str
    url: str
    status: str  # "ok" | "http_error" | "fetch_error" | "skipped"
    state: str = ""
    district: str = ""
    fetched_at: str | None = None
    http_status: int | None = None
    final_url: str | None = None
    content_type: str | None = None
    html_path: str | None = None
    png_path: str | None = None
    pdf_path: str | None = None
    extracted_path: str | None = None
    title: str | None = None
    n_emails: int = 0
    n_phones: int = 0
    n_specialties: int = 0
    n_claims: int = 0
    error: str | None = None


@dataclass
class ScrapeSummary:
    out_dir: str
    started_at: str
    finished_at: str
    total: int
    ok: int
    failed: int
    skipped: int
    records: list[ScrapeRecord] = field(default_factory=list)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _make_parser_soup(html: str) -> BeautifulSoup:
    """Parse HTML, preferring lxml, falling back to the stdlib parser."""
    try:
        return BeautifulSoup(html, "lxml")
    except Exception:  # noqa: BLE001 — lxml may not be installed
        return BeautifulSoup(html, "html.parser")


# --------------------------------------------------------------- targets
def _normalise_url(url: str | None) -> str | None:
    if not url:
        return None
    # Real data carries stray wrapping quotes/whitespace (e.g. '"esic.nic.in"').
    url = str(url).strip().strip("\"'").strip()
    if not url or url.lower() in {"nan", "none", "null"}:
        return None
    # urlparse raises ValueError on some malformed hosts (bad IPv6 brackets,
    # control chars, …); a single bad row must not abort the whole crawl.
    try:
        if not urlparse(url).scheme:
            url = "https://" + url
        parsed = urlparse(url)
    except ValueError:
        return None
    if not parsed.netloc:
        return None
    return url


def targets_from_facilities(*, all_districts: bool = False) -> list[ScrapeTarget]:
    """Build scrape targets from the configured data source (DB or CSV).

    By default the crawl is scoped to the pilot districts (``CRAWL_REGIONS``);
    pass ``all_districts=True`` to crawl every facility that has a website.
    """
    from .data import load_bundle

    facilities = load_bundle().facilities
    if "website_url" not in facilities.columns:
        logger.warning(
            "Facilities have no `website_url` column — nothing to scrape. "
            "Regenerate the dataset (`python -m src.data`) or populate the column."
        )
        return []

    targets: list[ScrapeTarget] = []
    out_of_scope = 0
    excluded_type = 0
    for row in facilities.itertuples(index=False):
        url = _normalise_url(getattr(row, "website_url", None))
        if not url:
            continue
        # Skip small primary-care / clinic types regardless of district scope —
        # they aren't part of the deep crawl + analysis (see EXCLUDED_TYPES).
        if _is_excluded_type(str(getattr(row, "type", "") or "")):
            excluded_type += 1
            continue
        state = str(getattr(row, "state", "") or "")
        district = str(getattr(row, "district", "") or "")
        if not all_districts and not _in_crawl_scope(district, state):
            out_of_scope += 1
            continue
        targets.append(
            ScrapeTarget(
                facility_id=str(getattr(row, "facility_id", "")) or url,
                name=str(getattr(row, "name", "")),
                url=url,
                state=state,
                district=district,
            )
        )

    if all_districts:
        logger.info(
            "Crawl scope: all districts — {} facility URL(s); skipped {} "
            "excluded type(s) ({}).",
            len(targets), excluded_type, ", ".join(sorted(EXCLUDED_TYPES)),
        )
    else:
        logger.info(
            "Crawl scope: {} facility URL(s) within the pilot districts "
            "({}); skipped {} out-of-scope and {} excluded type(s). Pass "
            "--all-districts to crawl everywhere.",
            len(targets), CRAWL_SCOPE_LABEL, out_of_scope, excluded_type,
        )
    return targets


def targets_from_input(path: Path) -> list[ScrapeTarget]:
    """Build targets from a CSV (``website_url``/``url`` column) or a ``.txt``."""
    targets: list[ScrapeTarget] = []
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            fields = {f.lower(): f for f in (reader.fieldnames or [])}
            url_field = fields.get("website_url") or fields.get("url")
            id_field = fields.get("facility_id")
            name_field = fields.get("name")
            state_field = fields.get("state")
            district_field = fields.get("district")
            if not url_field:
                raise ValueError(
                    f"{path} needs a `website_url` or `url` column "
                    f"(found: {list(reader.fieldnames or [])})"
                )
            for i, row in enumerate(reader):
                url = _normalise_url(row.get(url_field))
                if not url:
                    continue
                targets.append(
                    ScrapeTarget(
                        facility_id=(row.get(id_field) if id_field else "") or f"row-{i}",
                        name=(row.get(name_field) if name_field else "") or "",
                        url=url,
                        state=(row.get(state_field) if state_field else "") or "",
                        district=(row.get(district_field) if district_field else "") or "",
                    )
                )
    else:  # plain text, one URL per line
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
            url = _normalise_url(line)
            if url:
                targets.append(ScrapeTarget(facility_id=f"url-{i}", name="", url=url))
    return targets


# --------------------------------------------------------------- fetching
def _build_session(user_agent: str | None = None) -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": user_agent or USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-IN,en;q=0.9",
        }
    )
    return session


def fetch(
    session: requests.Session,
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
) -> requests.Response:
    """GET ``url`` with a few retries on transient/network errors."""
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = session.get(url, timeout=timeout, allow_redirects=True)
            return resp
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < retries:
                wait = 1.5 * (attempt + 1)
                logger.warning("Fetch failed ({}), retrying in {:.1f}s…", exc, wait)
                time.sleep(wait)
    raise last_exc  # type: ignore[misc]


# --------------------------------------------------------------- extraction
def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def _meta(soup: BeautifulSoup, *, name: str | None = None, prop: str | None = None) -> str | None:
    if name:
        tag = soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return _clean(tag["content"])
    if prop:
        tag = soup.find("meta", attrs={"property": prop})
        if tag and tag.get("content"):
            return _clean(tag["content"])
    return None


def _valid_phones(text: str) -> list[str]:
    phones: list[str] = []
    for match in _PHONE_RE.findall(text):
        digits = re.sub(r"\D", "", match)
        # Indian landline/mobile numbers are 10 digits (optionally +91 / leading 0).
        if 10 <= len(digits) <= 13:
            phones.append(re.sub(r"\s+", " ", match).strip())
    return phones


def _addresses(soup: BeautifulSoup) -> list[str]:
    found: list[str] = []
    for tag in soup.find_all(attrs={"itemprop": "address"}):
        if text := _clean(tag.get_text(" ")):
            found.append(text)
    for tag in soup.find_all("address"):
        if text := _clean(tag.get_text(" ")):
            found.append(text)
    return found


def _specialties(haystack: str) -> list[str]:
    """Canonical clinical specialities / treatments advertised in the page text.

    Scans ``haystack`` against :data:`SPECIALTY_VOCAB` and returns the matched
    canonical labels (e.g. ``["Cardiology", "Dialysis", "Oncology"]``), sorted and
    de-duped. Empty when the page mentions none.
    """
    found = {canonical for canonical, pattern in _SPECIALTY_PATTERNS if pattern.search(haystack)}
    return sorted(found)


def _claim_snippet(sentence: str, match: re.Match[str]) -> str:
    """A bounded, readable claim snippet from ``sentence`` around ``match``.

    Short sentences are returned whole; long ones (menu/navigation dumps with no
    punctuation) are reduced to a ~:data:`CLAIM_MAX_CHARS` window centered on the
    matched term, with ellipses marking the trim.
    """
    sentence = sentence.strip()
    if len(sentence) <= CLAIM_MAX_CHARS:
        return sentence
    half = CLAIM_MAX_CHARS // 2
    start = max(0, match.start() - half)
    end = min(len(sentence), start + CLAIM_MAX_CHARS)
    window = sentence[start:end].strip()
    return f"{'…' if start > 0 else ''}{window}{'…' if end < len(sentence) else ''}"


def _capability_claims(haystack: str) -> list[dict]:
    """Self-reported claims about the tracked capabilities, mined from page text.

    Splits ``haystack`` into sentences and, for each capability in
    :data:`CAPABILITY_CLAIM_TERMS`, saves up to
    :data:`MAX_CLAIMS_PER_CAPABILITY` distinct sentences that mention one of its
    terms. Each claim is ``{"capability", "term", "snippet"}`` — the snippet quoted
    verbatim from the page so it stands as evidence, never paraphrased.
    """
    sentences = [s for s in _SENTENCE_SPLIT_RE.split(haystack) if s.strip()]
    claims: list[dict] = []
    for capability, pattern in _CAPABILITY_PATTERNS:
        seen: set[str] = set()
        for sentence in sentences:
            match = pattern.search(sentence)
            if not match:
                continue
            snippet = _claim_snippet(sentence, match)
            key = snippet.lower()
            if key in seen:
                continue
            seen.add(key)
            claims.append({
                "capability": capability,
                "term": match.group(0).lower(),
                "snippet": snippet,
            })
            if len(seen) >= MAX_CLAIMS_PER_CAPABILITY:
                break
    return claims


def extract(html: str, source_url: str) -> dict:
    """Parse the page into a dict of useful, structured fields."""
    soup = _make_parser_soup(html)

    for bad in soup(["script", "style", "noscript", "template"]):
        bad.decompose()

    title = None
    if soup.title and soup.title.string:
        title = _clean(soup.title.string)
    title = title or _meta(soup, prop="og:title")

    h1 = soup.find("h1")
    heading = _clean(h1.get_text(" ")) if h1 else None
    description = _meta(soup, name="description") or _meta(soup, prop="og:description")

    text = soup.get_text(" ", strip=True)
    emails = sorted({m.lower() for m in _EMAIL_RE.findall(text)})
    phones = sorted(set(_valid_phones(text)))
    # Detect specialities across the headline fields + body so a marquee speciality
    # named only in the <title>/meta (not the visible body) is still captured.
    headline = " ".join(filter(None, [title, heading, description]))
    specialties = _specialties(f"{headline} {text}")
    # Per-capability claims: the actual sentences the site uses to assert a tracked
    # capability (ICU / Maternity / Emergency / Oncology / Trauma / NICU), saved
    # verbatim as evidence. Headline fields are joined with a period so a claim in
    # the <title>/meta reads as its own sentence rather than merging with the body.
    capability_claims = _capability_claims(f"{headline}. {text}" if headline else text)

    return {
        "source_url": source_url,
        "title": title,
        "heading": heading,
        "description": description,
        "emails": emails,
        "phones": phones,
        "specialties": specialties,
        "capability_claims": capability_claims,
        "addresses": _addresses(soup),
        "text": text[:MAX_TEXT_CHARS],
        "text_truncated": len(text) > MAX_TEXT_CHARS,
        "extracted_at": _now_iso(),
    }


# --------------------------------------------------------------- page capture
def render_homepage_thumbnails(
    url: str,
    facility_dir: Path,
    *,
    user_agent: str | None = None,
    timeout_ms: int = 30_000,
) -> tuple[Path | None, Path | None]:
    """Capture a PNG viewport thumbnail and PDF of the live homepage.

    Uses headless Chromium (Playwright). Returns ``(png_path, pdf_path)`` when
    both artifacts are written, otherwise ``(None, None)`` on missing deps or
    capture failure — the HTML scrape itself is unaffected.
    """
    png_path = facility_dir / "homepage.png"
    pdf_path = facility_dir / "homepage.pdf"
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.warning(
            "playwright is not installed — skipping homepage PNG/PDF for {} "
            "(pip install playwright && playwright install chromium)",
            url,
        )
        return None, None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                context = browser.new_context(
                    user_agent=user_agent or USER_AGENT,
                    viewport=THUMBNAIL_VIEWPORT,
                )
                page = context.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                page.wait_for_timeout(THUMBNAIL_SETTLE_MS)
                page.screenshot(path=str(png_path), full_page=False)
                page.pdf(path=str(pdf_path), format="A4", print_background=True)
            finally:
                browser.close()
    except PlaywrightError as exc:
        logger.warning("Homepage capture failed for {}: {}", url, exc)
        return None, None

    return png_path, pdf_path


def _attach_thumbnail_paths(record: ScrapeRecord, facility_dir: Path) -> None:
    """Populate manifest paths when thumbnail files already exist on disk."""
    png_path = facility_dir / "homepage.png"
    pdf_path = facility_dir / "homepage.pdf"
    if png_path.exists():
        record.png_path = str(png_path)
    if pdf_path.exists():
        record.pdf_path = str(pdf_path)


def _capture_thumbnails(
    record: ScrapeRecord,
    *,
    url: str,
    facility_dir: Path,
    user_agent: str | None,
    timeout: float,
) -> None:
    """Render homepage PNG/PDF and attach paths to ``record`` when successful."""
    png, pdf = render_homepage_thumbnails(
        url,
        facility_dir,
        user_agent=user_agent,
        timeout_ms=int(timeout * 1000),
    )
    if png:
        record.png_path = str(png)
    if pdf:
        record.pdf_path = str(pdf)


# --------------------------------------------------------------- scrape one
def scrape_one(
    session: requests.Session,
    target: ScrapeTarget,
    out_dir: Path,
    *,
    timeout: float,
    retries: int,
    force: bool,
    thumbnails: bool = True,
    user_agent: str | None = None,
) -> ScrapeRecord:
    record = ScrapeRecord(
        facility_id=target.facility_id,
        name=target.name,
        url=target.url,
        status="ok",
        state=target.state,
        district=target.district,
    )
    facility_dir = facility_subdir(
        out_dir,
        facility_id=target.facility_id,
        name=target.name,
        state=target.state,
        district=target.district,
    )
    html_path = facility_dir / "page.html"
    extracted_path = facility_dir / "extracted.json"
    png_path = facility_dir / "homepage.png"
    pdf_path = facility_dir / "homepage.pdf"
    thumbnails_cached = png_path.exists() and pdf_path.exists()

    if not force and extracted_path.exists() and (not thumbnails or thumbnails_cached):
        logger.debug("Skip (cached): {}", target.url)
        record.status = "ok"
        record.html_path = str(html_path) if html_path.exists() else None
        record.extracted_path = str(extracted_path)
        _attach_thumbnail_paths(record, facility_dir)
        try:
            cached = json.loads(extracted_path.read_text(encoding="utf-8"))
            record.title = cached.get("title")
            record.n_emails = len(cached.get("emails", []))
            record.n_phones = len(cached.get("phones", []))
            record.n_specialties = len(cached.get("specialties", []))
            record.n_claims = len(cached.get("capability_claims", []))
        except Exception:  # noqa: BLE001
            pass
        record.fetched_at = _now_iso()
        return record

    if not force and extracted_path.exists() and thumbnails and not thumbnails_cached:
        logger.debug("Backfill homepage thumbnails for cached scrape: {}", target.url)
        record.status = "ok"
        record.html_path = str(html_path) if html_path.exists() else None
        record.extracted_path = str(extracted_path)
        _attach_thumbnail_paths(record, facility_dir)
        try:
            cached = json.loads(extracted_path.read_text(encoding="utf-8"))
            record.title = cached.get("title")
            record.n_emails = len(cached.get("emails", []))
            record.n_phones = len(cached.get("phones", []))
            record.n_specialties = len(cached.get("specialties", []))
            record.n_claims = len(cached.get("capability_claims", []))
            capture_url = cached.get("source_url") or target.url
        except Exception:  # noqa: BLE001
            capture_url = target.url
        facility_dir.mkdir(parents=True, exist_ok=True)
        _capture_thumbnails(
            record,
            url=capture_url,
            facility_dir=facility_dir,
            user_agent=user_agent,
            timeout=timeout,
        )
        record.fetched_at = _now_iso()
        return record

    try:
        resp = fetch(session, target.url, timeout=timeout, retries=retries)
    except requests.RequestException as exc:
        logger.error("Fetch error for {}: {}", target.url, exc)
        record.status = "fetch_error"
        record.error = str(exc)
        record.fetched_at = _now_iso()
        return record

    record.fetched_at = _now_iso()
    record.http_status = resp.status_code
    record.final_url = str(resp.url)
    record.content_type = resp.headers.get("Content-Type")

    # requests falls back to ISO-8859-1 when the server sends no charset, which
    # mangles UTF-8 pages (common for multilingual Indian sites). Sniff instead.
    if "charset" not in (record.content_type or "").lower():
        resp.encoding = resp.apparent_encoding or resp.encoding

    if resp.status_code >= 400:
        logger.warning("HTTP {} for {}", resp.status_code, target.url)
        record.status = "http_error"
        record.error = f"HTTP {resp.status_code}"
        return record

    facility_dir.mkdir(parents=True, exist_ok=True)
    html = resp.text
    html_path.write_text(html, encoding="utf-8")
    record.html_path = str(html_path)

    extracted = extract(html, record.final_url or target.url)
    extracted["facility_id"] = target.facility_id
    extracted["facility_name"] = target.name
    extracted["http_status"] = resp.status_code
    extracted_path.write_text(
        json.dumps(extracted, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    record.extracted_path = str(extracted_path)
    record.title = extracted.get("title")
    record.n_emails = len(extracted["emails"])
    record.n_phones = len(extracted["phones"])
    record.n_specialties = len(extracted["specialties"])
    record.n_claims = len(extracted["capability_claims"])
    if thumbnails:
        _capture_thumbnails(
            record,
            url=record.final_url or target.url,
            facility_dir=facility_dir,
            user_agent=user_agent,
            timeout=timeout,
        )
    logger.success(
        "Scraped {} ({} emails, {} phones, {} specialities, {} capability claims{})",
        target.url, record.n_emails, record.n_phones, record.n_specialties, record.n_claims,
        ", thumbnails saved" if record.png_path and record.pdf_path else "",
    )
    return record


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._\-]+", "_", value).strip("_")
    return slug or "facility"


def _human_slug(value: str | None, *, max_len: int = 60) -> str:
    """Lowercase, hyphenated, filesystem-safe slug (e.g. 'Tamil Nadu' → 'tamil-nadu')."""
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    if len(slug) > max_len:
        slug = slug[:max_len].rstrip("-")
    return slug


def facility_subdir(
    out_dir: Path,
    *,
    facility_id: str,
    name: str = "",
    state: str = "",
    district: str = "",
) -> Path:
    """Hierarchical, human-readable snapshot dir: ``<state>/<district>/<name>-<id>``.

    Geography and name are slugified for readability; the facility id is appended
    as a suffix so the leaf folder stays unique even when names collide. Missing
    geography falls back to ``unknown-state`` / ``unknown-district``.
    """
    state_slug = _human_slug(state) or "unknown-state"
    district_slug = _human_slug(district) or "unknown-district"
    name_slug = _human_slug(name)
    id_suffix = _safe_slug(str(facility_id)) or "facility"
    leaf = f"{name_slug}-{id_suffix}" if name_slug else id_suffix
    return out_dir / state_slug / district_slug / leaf


# --------------------------------------------------------------- scrape all
def scrape(
    targets: list[ScrapeTarget],
    out_dir: Path = DEFAULT_OUT_DIR,
    *,
    delay: float = DEFAULT_DELAY,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    limit: int | None = None,
    force: bool = False,
    thumbnails: bool = True,
    user_agent: str | None = None,
) -> ScrapeSummary:
    """Scrape every target, writing snapshots + a manifest to ``out_dir``.

    ``user_agent`` overrides the default research-bot UA — pass a browser UA for
    sites that 403 automated agents (many large hospital chains do).
    """
    if limit is not None:
        targets = targets[:limit]

    out_dir.mkdir(parents=True, exist_ok=True)
    started_at = _now_iso()
    session = _build_session(user_agent)

    records: list[ScrapeRecord] = []
    logger.info("Scraping {} facility website(s) → {}", len(targets), out_dir)
    for i, target in enumerate(targets, start=1):
        logger.info("[{}/{}] {}", i, len(targets), target.url)
        record = scrape_one(
            session,
            target,
            out_dir,
            timeout=timeout,
            retries=retries,
            force=force,
            thumbnails=thumbnails,
            user_agent=user_agent,
        )
        records.append(record)
        if delay and i < len(targets):
            time.sleep(delay)

    ok = sum(1 for r in records if r.status == "ok")
    skipped = sum(1 for r in records if r.status == "skipped")
    failed = sum(1 for r in records if r.status in {"http_error", "fetch_error"})
    summary = ScrapeSummary(
        out_dir=str(out_dir),
        started_at=started_at,
        finished_at=_now_iso(),
        total=len(records),
        ok=ok,
        failed=failed,
        skipped=skipped,
        records=records,
    )

    manifest_path = out_dir / "manifest.json"
    manifest = {
        **{k: v for k, v in asdict(summary).items() if k != "records"},
        "records": [asdict(r) for r in records],
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.success(
        "Done: {} ok, {} failed, {} skipped → {}",
        ok,
        failed,
        skipped,
        manifest_path,
    )
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        help="CSV (website_url/url column) or .txt (one URL per line) to scrape "
        "instead of the facilities data source.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help=f"Output directory (default: {DEFAULT_OUT_DIR}).",
    )
    parser.add_argument(
        "--limit", type=int, help="Only scrape the first N targets."
    )
    parser.add_argument(
        "--delay", type=float, default=DEFAULT_DELAY,
        help=f"Seconds to wait between requests (default: {DEFAULT_DELAY}).",
    )
    parser.add_argument(
        "--timeout", type=float, default=DEFAULT_TIMEOUT,
        help=f"Per-request timeout in seconds (default: {DEFAULT_TIMEOUT}).",
    )
    parser.add_argument(
        "--retries", type=int, default=DEFAULT_RETRIES,
        help=f"Retries on network errors (default: {DEFAULT_RETRIES}).",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-scrape even if a cached extraction already exists.",
    )
    parser.add_argument(
        "--no-thumbnails", action="store_true",
        help="Skip homepage PNG/PDF capture (HTML + extracted JSON only).",
    )
    parser.add_argument(
        "--all-districts", action="store_true",
        help="Crawl every facility URL, ignoring the pilot district scope "
        f"({CRAWL_SCOPE_LABEL}).",
    )
    args = parser.parse_args(argv)

    if args.input:
        if not args.input.exists():
            parser.error(f"--input file not found: {args.input}")
        targets = targets_from_input(args.input)
    else:
        targets = targets_from_facilities(all_districts=args.all_districts)

    if not targets:
        logger.warning(
            "No facility URLs to scrape. Populate `website_url` in the facilities "
            "data, or pass --input with a list of URLs."
        )
        return 0

    scrape(
        targets,
        out_dir=args.out,
        delay=args.delay,
        timeout=args.timeout,
        retries=args.retries,
        limit=args.limit,
        force=args.force,
        thumbnails=not args.no_thumbnails,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
