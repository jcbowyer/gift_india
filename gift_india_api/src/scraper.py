"""Scrape facility official websites and store the results under ``data/scraped``.

The scraper reads facility records (from the live database when configured, else
the synthetic CSV bundle) and visits the ``website_url`` of every facility that
has one. For each site it stores a raw HTML snapshot plus an extracted JSON of
the useful fields (title, description, emails, phones, address, visible text),
and writes a ``manifest.json`` summarising every scrape attempt.

Synthetic demo facilities have an empty ``website_url`` and are skipped — there
are no real sites to fetch. Populate ``website_url`` (from the governed Virtue
Foundation dataset or via ``--input``) to actually scrape.

Output layout::

    data/scraped/
    ├── manifest.json              # one record per facility attempted
    └── <facility_id>/
        ├── page.html             # raw HTML snapshot
        └── extracted.json        # structured fields parsed from the page

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

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# Indian numbers (optional +91/0 prefix, 10 digits) and generic 7-15 digit runs.
_PHONE_RE = re.compile(
    r"(?:(?:\+?91[\-\s]?)|0)?(?:\d[\-\s]?){9,14}\d"
)


@dataclass
class ScrapeTarget:
    """A single thing to scrape."""

    facility_id: str
    name: str
    url: str


@dataclass
class ScrapeRecord:
    """The outcome of one scrape attempt (one row of the manifest)."""

    facility_id: str
    name: str
    url: str
    status: str  # "ok" | "http_error" | "fetch_error" | "skipped"
    fetched_at: str | None = None
    http_status: int | None = None
    final_url: str | None = None
    content_type: str | None = None
    html_path: str | None = None
    extracted_path: str | None = None
    title: str | None = None
    n_emails: int = 0
    n_phones: int = 0
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
    url = str(url).strip()
    if not url or url.lower() in {"nan", "none", "null"}:
        return None
    if not urlparse(url).scheme:
        url = "https://" + url
    parsed = urlparse(url)
    if not parsed.netloc:
        return None
    return url


def targets_from_facilities() -> list[ScrapeTarget]:
    """Build scrape targets from the configured data source (DB or CSV)."""
    from .data import load_bundle

    facilities = load_bundle().facilities
    if "website_url" not in facilities.columns:
        logger.warning(
            "Facilities have no `website_url` column — nothing to scrape. "
            "Regenerate the dataset (`python -m src.data`) or populate the column."
        )
        return []

    targets: list[ScrapeTarget] = []
    for row in facilities.itertuples(index=False):
        url = _normalise_url(getattr(row, "website_url", None))
        if url:
            targets.append(
                ScrapeTarget(
                    facility_id=str(getattr(row, "facility_id", "")) or url,
                    name=str(getattr(row, "name", "")),
                    url=url,
                )
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
                    )
                )
    else:  # plain text, one URL per line
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
            url = _normalise_url(line)
            if url:
                targets.append(ScrapeTarget(facility_id=f"url-{i}", name="", url=url))
    return targets


# --------------------------------------------------------------- fetching
def _build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
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
    description = _meta(soup, name="description") or _meta(soup, prop="og:description")

    text = soup.get_text(" ", strip=True)
    emails = sorted({m.lower() for m in _EMAIL_RE.findall(text)})
    phones = sorted(set(_valid_phones(text)))

    return {
        "source_url": source_url,
        "title": title,
        "heading": _clean(h1.get_text(" ")) if h1 else None,
        "description": description,
        "emails": emails,
        "phones": phones,
        "addresses": _addresses(soup),
        "text": text[:MAX_TEXT_CHARS],
        "text_truncated": len(text) > MAX_TEXT_CHARS,
        "extracted_at": _now_iso(),
    }


# --------------------------------------------------------------- scrape one
def scrape_one(
    session: requests.Session,
    target: ScrapeTarget,
    out_dir: Path,
    *,
    timeout: float,
    retries: int,
    force: bool,
) -> ScrapeRecord:
    record = ScrapeRecord(
        facility_id=target.facility_id, name=target.name, url=target.url, status="ok"
    )
    facility_dir = out_dir / _safe_slug(target.facility_id)
    html_path = facility_dir / "page.html"
    extracted_path = facility_dir / "extracted.json"

    if not force and extracted_path.exists():
        logger.debug("Skip (cached): {}", target.url)
        record.status = "ok"
        record.html_path = str(html_path) if html_path.exists() else None
        record.extracted_path = str(extracted_path)
        try:
            cached = json.loads(extracted_path.read_text(encoding="utf-8"))
            record.title = cached.get("title")
            record.n_emails = len(cached.get("emails", []))
            record.n_phones = len(cached.get("phones", []))
        except Exception:  # noqa: BLE001
            pass
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
    logger.success(
        "Scraped {} ({} emails, {} phones)", target.url, record.n_emails, record.n_phones
    )
    return record


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._\-]+", "_", value).strip("_")
    return slug or "facility"


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
) -> ScrapeSummary:
    """Scrape every target, writing snapshots + a manifest to ``out_dir``."""
    if limit is not None:
        targets = targets[:limit]

    out_dir.mkdir(parents=True, exist_ok=True)
    started_at = _now_iso()
    session = _build_session()

    records: list[ScrapeRecord] = []
    logger.info("Scraping {} facility website(s) → {}", len(targets), out_dir)
    for i, target in enumerate(targets, start=1):
        logger.info("[{}/{}] {}", i, len(targets), target.url)
        record = scrape_one(
            session, target, out_dir, timeout=timeout, retries=retries, force=force
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
    args = parser.parse_args(argv)

    if args.input:
        if not args.input.exists():
            parser.error(f"--input file not found: {args.input}")
        targets = targets_from_input(args.input)
    else:
        targets = targets_from_facilities()

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
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
