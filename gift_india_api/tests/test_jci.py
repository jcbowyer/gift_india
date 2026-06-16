"""Unit tests for the JCI accreditation seed pipeline.

Covers the entity-resolution name normalization (the part that must stay in
lock-step with the dbt `jci_normalize` macro), the stable org-id hash, the seed
reader + manifest builder, and the bronze row builder / upsert columns — all with
fakes (no real network or Postgres).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src import jci_scraper, load_jci


# --------------------------------------------------------------- normalization
@pytest.mark.parametrize(
    "name, expected",
    [
        # Generic/legal tokens are stripped; a real brand survives intact.
        ("Apollo Hospitals Enterprise Limited", "apollo"),
        ("Fortis Memorial Research Institute", "fortis memorial"),
        ("Medanta - The Medicity", "medanta"),
        ("AIG Hospitals", "aig"),
        ("Dr. Rela Institute & Medical Centre", "dr rela"),
        # A locality embedded in the name is retained (we don't strip arbitrary
        # place words) — brand_key + state does the cross-naming match instead.
        ("Apollo Hospital, Chennai", "apollo chennai"),
    ],
)
def test_normalize_name_collapses_to_brand(name, expected):
    assert jci_scraper.normalize_name(name) == expected


def test_brand_key_is_first_two_significant_tokens():
    assert jci_scraper.brand_key("Fortis Memorial Research Institute") == "fortis memorial"
    assert jci_scraper.brand_key("Apollo Hospitals, Greams Road") == "apollo greams"
    # Single distinctive token stays a single token.
    assert jci_scraper.brand_key("AIG Hospitals") == "aig"


def test_normalize_name_handles_empty_and_accents():
    assert jci_scraper.normalize_name(None) == ""
    assert jci_scraper.normalize_name("   ") == ""
    # Accents are folded so the key is ASCII-stable.
    assert jci_scraper.normalize_name("Médanta") == "medanta"


# --------------------------------------------------------------- org id
def test_org_id_is_deterministic_and_distinguishes_geography():
    a = jci_scraper._org_id("Apollo Hospitals", "Chennai", "Tamil Nadu")
    assert a == jci_scraper._org_id("Apollo Hospitals", "Chennai", "Tamil Nadu")
    # Same brand, different city -> different org.
    assert a != jci_scraper._org_id("Apollo Hospitals", "Hyderabad", "Telangana")
    assert len(a) == 16


# --------------------------------------------------------------- seed + collect
def _write_seed(path: Path) -> None:
    path.write_text(
        "jci_name,city,state,country,accreditation_program,source,source_url,verified_on_portal\n"
        "Indraprastha Apollo Hospital,New Delhi,Delhi,India,Hospital,karetrip,http://x,true\n"
        "Fortis Memorial Research Institute,Gurugram,Haryana,India,Hospital,karetrip,http://x,false\n",
        encoding="utf-8",
    )


def test_collect_builds_records_and_manifest_offline(tmp_path):
    seed = tmp_path / "seed.csv"
    _write_seed(seed)
    out = tmp_path / "jci"

    summary = jci_scraper.collect(seed_path=seed, out_dir=out, fetch_official_portal=False)

    assert summary.total == 2
    assert summary.verified_sample == 1
    assert summary.official_fetch == {"attempted": False}

    records = json.loads((out / "jci_accredited.json").read_text())
    assert {r["jci_name"] for r in records} == {
        "Indraprastha Apollo Hospital",
        "Fortis Memorial Research Institute",
    }
    # Every record carries the entity-resolution keys + provenance tag.
    apollo = next(r for r in records if r["jci_name"].startswith("Indraprastha"))
    assert apollo["match_name"] == "indraprastha apollo"
    assert apollo["data_source"] == "jci"
    assert (out / "manifest.json").exists()


def test_scrape_pages_builds_targets_and_links_snapshots(tmp_path, monkeypatch):
    # Two orgs (one with a website, one without) — only the first is scraped, and
    # its snapshot_dir is set to the <state>/<district>/<name>-<id> hierarchy.
    seed = tmp_path / "seed.csv"
    seed.write_text(
        "jci_name,city,state,website_url\n"
        "AIG Hospitals,Hyderabad,Telangana,https://www.aighospitals.com\n"
        "No Site Hospital,Pune,Maharashtra,\n",
        encoding="utf-8",
    )
    out = tmp_path / "jci"

    captured = {}

    def fake_scrape(targets, out_dir, **kw):
        captured["targets"] = targets
        # Materialize the snapshot dirs the way the real scraper would.
        from src import scraper
        for t in targets:
            d = scraper.facility_subdir(
                out_dir, facility_id=t.facility_id, name=t.name,
                state=t.state, district=t.district,
            )
            d.mkdir(parents=True, exist_ok=True)
            (d / "page.html").write_text("<html></html>", encoding="utf-8")
        return scraper.ScrapeSummary(
            out_dir=str(out_dir), started_at="", finished_at="",
            total=len(targets), ok=len(targets), failed=0, skipped=0,
        )

    monkeypatch.setattr("src.scraper.scrape", fake_scrape)

    summary = jci_scraper.collect(
        seed_path=seed, out_dir=out, scrape_pages_enabled=True
    )

    # Only the org with a website becomes a scrape target.
    assert [t.name for t in captured["targets"]] == ["AIG Hospitals"]
    assert captured["targets"][0].district == "Hyderabad"  # city -> district level

    records = {r["jci_name"]: r for r in json.loads((out / "jci_accredited.json").read_text())}
    assert records["AIG Hospitals"]["snapshot_dir"] == (
        "scraped/telangana/hyderabad/aig-hospitals-"
        + records["AIG Hospitals"]["jci_org_id"]
    )
    assert records["No Site Hospital"]["snapshot_dir"] is None
    assert summary.pages_scraped["ok"] == 1


def test_collect_is_idempotent_on_org_id(tmp_path):
    seed = tmp_path / "seed.csv"
    # Same hospital twice (duplicate aggregator rows) collapses to one org.
    seed.write_text(
        "jci_name,city,state,verified_on_portal\n"
        "AIG Hospitals,Hyderabad,Telangana,true\n"
        "AIG Hospitals,Hyderabad,Telangana,false\n",
        encoding="utf-8",
    )
    summary = jci_scraper.collect(seed_path=seed, out_dir=tmp_path / "jci", fetch_official_portal=False)
    assert summary.total == 1


# --------------------------------------------------------------- bronze rows
def test_jci_rows_builds_columns_in_order_and_dedupes(tmp_path):
    out = tmp_path / "jci"
    out.mkdir()
    (out / "jci_accredited.json").write_text(
        json.dumps(
            [
                {c: f"{c}-1" for c in load_jci._JCI_COLS},
                {c: f"{c}-1" for c in load_jci._JCI_COLS},  # duplicate org id
                {c: f"{c}-2" for c in load_jci._JCI_COLS},
            ]
        ),
        encoding="utf-8",
    )
    rows = load_jci.jci_rows(out)
    assert len(rows) == 2  # duplicate jci_org_id dropped
    # Tuple positions line up with the INSERT column list.
    assert rows[0] == tuple(f"{c}-1" for c in load_jci._JCI_COLS)


def test_jci_rows_missing_records_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_jci.jci_rows(tmp_path / "nope")
