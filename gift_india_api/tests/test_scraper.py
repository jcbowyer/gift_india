"""Unit tests for the facility website scraper (``src.scraper``).

Covers the pure logic that's easy to get subtly wrong — URL normalisation, the
email/phone extraction, slugging, snapshot paths, and input parsing — plus the
fetch retry loop and ``scrape_one``'s ok / http_error / fetch_error / cached
branches, all with fakes (no real network).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import requests

from src import scraper


# --------------------------------------------------------------- URL parsing
@pytest.mark.parametrize(
    "raw, expected",
    [
        ("example.com", "https://example.com"),
        ("http://example.com/path", "http://example.com/path"),
        ("  https://Example.com ", "https://Example.com"),
    ],
)
def test_normalise_url_adds_scheme_and_trims(raw, expected):
    assert scraper._normalise_url(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "   ", "nan", "None", "NULL", "https://"])
def test_normalise_url_rejects_empty_and_schemeless(raw):
    assert scraper._normalise_url(raw) is None


# --------------------------------------------------------------- extraction
def test_extract_pulls_structured_fields():
    html = """
    <html><head>
      <title>  Aravind   Eye  Hospital </title>
      <meta name="description" content="Eye care in Madurai">
    </head><body>
      <h1>Welcome</h1>
      <script>var email='hidden@evil.com';</script>
      <style>.x{color:red}</style>
      <p>Contact: Info@Aravind.org or care@aravind.org</p>
      <p>Phone: +91 452 4356 100</p>
      <address>1 Anna Nagar, Madurai</address>
    </body></html>
    """
    data = scraper.extract(html, "https://aravind.org")

    assert data["title"] == "Aravind Eye Hospital"  # whitespace collapsed
    assert data["heading"] == "Welcome"
    assert data["description"] == "Eye care in Madurai"
    # emails are lower-cased, de-duped and sorted; script content is stripped.
    assert data["emails"] == ["care@aravind.org", "info@aravind.org"]
    assert "hidden@evil.com" not in data["emails"]
    assert data["phones"]  # the +91 number was captured
    assert "1 Anna Nagar, Madurai" in data["addresses"]
    assert data["source_url"] == "https://aravind.org"


def test_extract_falls_back_to_og_title():
    html = '<html><head><meta property="og:title" content="OG Name"></head><body></body></html>'
    assert scraper.extract(html, "https://x.test")["title"] == "OG Name"


def test_extract_truncates_long_text():
    body = "word " * (scraper.MAX_TEXT_CHARS)  # well over the cap
    data = scraper.extract(f"<html><body>{body}</body></html>", "https://x.test")
    assert len(data["text"]) <= scraper.MAX_TEXT_CHARS
    assert data["text_truncated"] is True


@pytest.mark.parametrize(
    "text, expect_match",
    [
        ("Call +91 452 4356 100 now", True),       # 12 digits
        ("Reception: 044-2356-1234", True),         # 10 digits, hyphens
        ("Ref code 12345", False),                  # only 5 digits
        ("Year 2024 was great", False),             # 4 digits
    ],
)
def test_valid_phones(text, expect_match):
    assert bool(scraper._valid_phones(text)) is expect_match


# --------------------------------------------------------------- slugs / paths
@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Tamil Nadu", "tamil-nadu"),
        ("  Madurai  ", "madurai"),
        ("Dr. A.B.'s Clinic!!", "dr-a-b-s-clinic"),
        ("", ""),
    ],
)
def test_human_slug(raw, expected):
    assert scraper._human_slug(raw) == expected


def test_human_slug_truncates():
    assert len(scraper._human_slug("a " * 100, max_len=20)) <= 20


def test_facility_subdir_is_hierarchical_and_unique():
    out = Path("/tmp/scraped")
    a = scraper.facility_subdir(out, facility_id="VF-1", name="Aravind", state="Tamil Nadu", district="Madurai")
    b = scraper.facility_subdir(out, facility_id="VF-2", name="Aravind", state="Tamil Nadu", district="Madurai")
    assert a == out / "tamil-nadu" / "madurai" / "aravind-VF-1"
    assert a != b  # same name, different id -> distinct leaf


def test_facility_subdir_unknown_geography_fallbacks():
    sub = scraper.facility_subdir(Path("/tmp/s"), facility_id="X", name="")
    assert sub == Path("/tmp/s") / "unknown-state" / "unknown-district" / "X"


# --------------------------------------------------------------- input files
def test_targets_from_input_csv(tmp_path):
    csv_path = tmp_path / "urls.csv"
    csv_path.write_text(
        "facility_id,name,website_url,state,district\n"
        "VF-1,Aravind,aravind.org,Tamil Nadu,Madurai\n"
        "VF-2,Empty,,Kerala,Kochi\n",  # blank url -> skipped
        encoding="utf-8",
    )
    targets = scraper.targets_from_input(csv_path)
    assert len(targets) == 1
    t = targets[0]
    assert t.facility_id == "VF-1"
    assert t.url == "https://aravind.org"
    assert t.state == "Tamil Nadu"


def test_targets_from_input_csv_missing_url_column(tmp_path):
    csv_path = tmp_path / "bad.csv"
    csv_path.write_text("facility_id,name\nVF-1,Aravind\n", encoding="utf-8")
    with pytest.raises(ValueError, match="website_url"):
        scraper.targets_from_input(csv_path)


def test_targets_from_input_txt(tmp_path):
    txt = tmp_path / "urls.txt"
    txt.write_text("example.com\n\nhttps://test.org\n", encoding="utf-8")
    targets = scraper.targets_from_input(txt)
    assert [t.url for t in targets] == ["https://example.com", "https://test.org"]


# --------------------------------------------------------------- fetch retries
class _FlakySession:
    """Raises a connection error a fixed number of times, then returns a value."""

    def __init__(self, fail_times: int, response="OK"):
        self.fail_times = fail_times
        self.response = response
        self.calls = 0

    def get(self, url, **kwargs):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise requests.ConnectionError("boom")
        return self.response


def test_fetch_retries_then_succeeds(monkeypatch):
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)  # no real waiting
    session = _FlakySession(fail_times=2)
    assert scraper.fetch(session, "https://x.test", retries=2) == "OK"
    assert session.calls == 3  # 2 failures + 1 success


def test_fetch_raises_after_exhausting_retries(monkeypatch):
    monkeypatch.setattr(scraper.time, "sleep", lambda *_: None)
    session = _FlakySession(fail_times=5)
    with pytest.raises(requests.ConnectionError):
        scraper.fetch(session, "https://x.test", retries=2)
    assert session.calls == 3  # initial try + 2 retries


# --------------------------------------------------------------- scrape_one
class _FakeResponse:
    def __init__(self, *, status=200, text="<html></html>", url="https://x.test", content_type="text/html"):
        self.status_code = status
        self.text = text
        self.url = url
        self.headers = {"Content-Type": content_type}
        self.apparent_encoding = "utf-8"
        self.encoding = "utf-8"


def _target():
    return scraper.ScrapeTarget(
        facility_id="VF-1", name="Aravind", url="https://aravind.org",
        state="Tamil Nadu", district="Madurai",
    )


def test_scrape_one_ok_writes_snapshot_and_extraction(tmp_path, monkeypatch):
    html = '<html><head><title>Aravind</title></head><body><p>care@aravind.org</p></body></html>'
    monkeypatch.setattr(scraper, "fetch", lambda *a, **k: _FakeResponse(text=html))

    rec = scraper.scrape_one(
        session=None, target=_target(), out_dir=tmp_path,
        timeout=1, retries=0, force=False,
    )

    assert rec.status == "ok"
    assert rec.http_status == 200
    assert rec.title == "Aravind"
    assert rec.n_emails == 1
    assert Path(rec.html_path).read_text(encoding="utf-8") == html
    extracted = json.loads(Path(rec.extracted_path).read_text(encoding="utf-8"))
    assert extracted["emails"] == ["care@aravind.org"]
    assert extracted["facility_id"] == "VF-1"


def test_scrape_one_http_error(tmp_path, monkeypatch):
    monkeypatch.setattr(scraper, "fetch", lambda *a, **k: _FakeResponse(status=404))
    rec = scraper.scrape_one(
        session=None, target=_target(), out_dir=tmp_path, timeout=1, retries=0, force=False,
    )
    assert rec.status == "http_error"
    assert rec.http_status == 404
    assert rec.error == "HTTP 404"
    assert rec.html_path is None  # nothing written on error


def test_scrape_one_fetch_error(tmp_path, monkeypatch):
    def _boom(*a, **k):
        raise requests.ConnectionError("dns fail")

    monkeypatch.setattr(scraper, "fetch", _boom)
    rec = scraper.scrape_one(
        session=None, target=_target(), out_dir=tmp_path, timeout=1, retries=0, force=False,
    )
    assert rec.status == "fetch_error"
    assert "dns fail" in rec.error


def test_scrape_one_uses_cache_without_fetching(tmp_path, monkeypatch):
    # First scrape populates the cache.
    html = '<html><head><title>Cached</title></head><body><p>a@b.org x@y.org</p></body></html>'
    monkeypatch.setattr(scraper, "fetch", lambda *a, **k: _FakeResponse(text=html))
    scraper.scrape_one(None, _target(), tmp_path, timeout=1, retries=0, force=False)

    # Second scrape must NOT fetch again (force=False, extraction exists).
    def _explode(*a, **k):
        raise AssertionError("fetch should not be called when cache is warm")

    monkeypatch.setattr(scraper, "fetch", _explode)
    rec = scraper.scrape_one(None, _target(), tmp_path, timeout=1, retries=0, force=False)
    assert rec.status == "ok"
    assert rec.title == "Cached"
    assert rec.n_emails == 2  # read back from the cached extraction
