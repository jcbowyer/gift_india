#!/usr/bin/env python3
"""Build the app's gold.* serving tables from the REAL governed Virtue Foundation
dataset (Delta Share) and export each to CSV under data/gold_real/.

Run on the VF SQL warehouse (read-only over the share). The CSVs are then loaded
straight into gold.* by gift_india_api/src/load_gold_real.py — no bronze/dbt
rebuild, 100% governed data, every figure traceable to a real column value.

Env: PROFILE (default gift-india-mb), WAREHOUSE (default 234ccf680e359443).
"""
from __future__ import annotations

import csv
import io
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


def fetch(url: str, attempts: int = 5) -> str:
    """Download an external-link chunk, retrying on transient network errors."""
    last = None
    for i in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read().decode("utf-8")
        except Exception as exc:  # noqa: BLE001 — transient S3/network read
            last = exc
            time.sleep(2 * (i + 1))
    raise SystemExit(f"download failed after {attempts} tries: {last}")

PROFILE = os.environ.get("PROFILE", "gift-india-mb")
WAREHOUSE = os.environ.get("WAREHOUSE", "234ccf680e359443")
OUT = Path(__file__).resolve().parent / "gold_real"
OUT.mkdir(exist_ok=True)

VF = "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset"

# India state/UT -> 2-letter code (matches gift_india_dbt/seeds/state_codes.csv).
STATE_CODE_CASE = """
  CASE address_stateOrRegion
    WHEN 'Andhra Pradesh' THEN 'AP' WHEN 'Arunachal Pradesh' THEN 'AR'
    WHEN 'Assam' THEN 'AS' WHEN 'Bihar' THEN 'BR' WHEN 'Chhattisgarh' THEN 'CG'
    WHEN 'Goa' THEN 'GA' WHEN 'Gujarat' THEN 'GJ' WHEN 'Haryana' THEN 'HR'
    WHEN 'Himachal Pradesh' THEN 'HP' WHEN 'Jharkhand' THEN 'JH'
    WHEN 'Karnataka' THEN 'KA' WHEN 'Kerala' THEN 'KL' WHEN 'Madhya Pradesh' THEN 'MP'
    WHEN 'Maharashtra' THEN 'MH' WHEN 'Manipur' THEN 'MN' WHEN 'Meghalaya' THEN 'ML'
    WHEN 'Mizoram' THEN 'MZ' WHEN 'Nagaland' THEN 'NL' WHEN 'Odisha' THEN 'OD'
    WHEN 'Punjab' THEN 'PB' WHEN 'Rajasthan' THEN 'RJ' WHEN 'Sikkim' THEN 'SK'
    WHEN 'Tamil Nadu' THEN 'TN' WHEN 'Telangana' THEN 'TG' WHEN 'Tripura' THEN 'TR'
    WHEN 'Uttar Pradesh' THEN 'UP' WHEN 'Uttarakhand' THEN 'UK' WHEN 'West Bengal' THEN 'WB'
    WHEN 'Delhi' THEN 'DL' WHEN 'Jammu & Kashmir' THEN 'JK' WHEN 'Ladakh' THEN 'LA'
    WHEN 'Chandigarh' THEN 'CH' WHEN 'Puducherry' THEN 'PY'
    WHEN 'Andaman & Nicobar Islands' THEN 'AN' WHEN 'Lakshadweep' THEN 'LD'
    ELSE NULL
  END
"""

# ---- Shared enriched base: one real facility per row, with computed signals. ----
# Every derived value traces to a real VF column. match_confidence is built from
# real corroboration signals (website<->name match, page recency, social presence,
# fact density, affiliated-staff presence) — it replaces the synthetic NER score.
BASE = f"""
base AS (
  SELECT
    unique_id AS facility_id,
    trim(name) AS name,
    nullif(trim(address_city), '') AS district,
    nullif(trim(address_stateOrRegion), '') AS state,
    {STATE_CODE_CASE} AS state_code,
    try_cast(capacity AS int) AS beds,
    latitude AS lat, longitude AS lon,
    nullif(trim(officialWebsite), '') AS website_url,
    specialties AS raw_specialties,
    lower(coalesce(specialties,'') || ' ' || coalesce(capability,'') || ' ' || coalesce(procedure,'')) AS evidence_text,
    capability AS raw_capability,
    try_cast(distinct_social_media_presence_count AS int) AS social,
    try_cast(number_of_facts_about_the_organization AS int) AS facts,
    (affiliated_staff_presence = 'true') AS staff,
    try_cast(recency_of_page_update AS date) AS recency,
    lower(regexp_replace(officialWebsite, '[^A-Za-z]', '')) AS web,
    filter(split(lower(regexp_replace(name, '[^A-Za-z ]', '')), ' '), w -> length(w) >= 5) AS name_words
  FROM {VF}.facilities
  WHERE address_countryCode = 'IN' AND name IS NOT NULL AND trim(name) <> ''
),
enr AS (
  SELECT *,
    exists(name_words, w -> web LIKE '%' || w || '%') AS name_in_web,
    (recency >= add_months(current_date(), -24)) AS recent,
    (evidence_text RLIKE 'surgery|surgical|operat|theatre') AS offers_surgery
  FROM base
),
fac AS (
  SELECT *,
    least(1.0, greatest(0.0,
        0.25
      + (CASE WHEN name_in_web THEN 0.30 ELSE 0.0 END)
      + (CASE WHEN recent THEN 0.15 ELSE 0.0 END)
      + (CASE WHEN social >= 3 THEN 0.10 ELSE 0.0 END)
      + (CASE WHEN facts >= 10 THEN 0.10 ELSE 0.0 END)
      + (CASE WHEN staff THEN 0.10 ELSE 0.0 END)
    )) AS match_confidence,
    -- display type derived from the real facility name
    CASE
      WHEN lower(name) RLIKE 'medical college|institute of medical' THEN 'Medical College Hospital'
      WHEN lower(name) RLIKE 'community health' THEN 'Community Health Centre'
      WHEN lower(name) RLIKE 'primary health|phc' THEN 'Primary Health Centre'
      WHEN lower(name) RLIKE 'district hospital|government|govt|general hospital' THEN 'District Hospital'
      WHEN lower(name) RLIKE 'trust|mission|charitable|foundation' THEN 'Charitable / Mission Hospital'
      WHEN lower(name) RLIKE 'clinic|centre|center' THEN 'Clinic / Centre'
      ELSE 'Private Hospital'
    END AS type,
    -- cleaned, de-duplicated specialty list for display
    array_join(array_distinct(
      transform(
        filter(
          from_json(coalesce(raw_specialties,'[]'), 'array<string>'),
          s -> s IS NOT NULL AND trim(s) <> ''
        ),
        s -> trim(s)
      )
    ), ' | ') AS specialties
  FROM enr
)
"""

# Capability catalog (must match gift_india_dbt/seeds/capabilities.csv).
CAPS = """
caps AS (
  SELECT * FROM VALUES
    ('maternity','Maternity','Labour & delivery, including emergency C-section capability.','obstetric|gynaec|gynec|maternity|labour|labor|delivery|obgyn|midwif'),
    ('emergency','Emergency','24x7 casualty / emergency department with resuscitation.','emergency|casualty|accident|trauma|resuscitat|24x7|24/7'),
    ('trauma','Trauma','Trauma & accident care: imaging, OT, blood bank, trauma surgery.','trauma|orthop|fracture|accident|general surgery|surgery'),
    ('oncology','Oncology','Cancer care: chemotherapy, and/or radiation or surgical oncology.','oncolog|cancer|chemo|radiation|tumou|tumor'),
    ('icu','ICU','Adult intensive care: ventilators, monitored beds, intensivist cover.','icu|intensive|critical care|criticalcare|ventilat'),
    ('nicu','NICU','Neonatal intensive care for premature / critically ill newborns.','neonat|nicu|paediatric|pediatric|newborn')
  AS t(capability, capability_label, capability_description, pat)
),
assess AS (
  SELECT
    f.facility_id, c.capability, c.capability_label, c.capability_description,
    (f.evidence_text RLIKE c.pat) AS supports,
    f.name_in_web, f.match_confidence, f.website_url, f.recency, f.recent,
    f.social, f.facts, f.staff, f.specialties, f.type, f.beds, f.raw_capability
  FROM fac f CROSS JOIN caps c
),
signal AS (
  SELECT *,
    CASE WHEN supports THEN true ELSE false END AS claimed,
    CASE
      WHEN NOT supports THEN 'no_claim'
      WHEN supports AND name_in_web AND match_confidence >= 0.70 THEN 'strong'
      WHEN supports AND NOT name_in_web THEN 'weak_suspicious'
      WHEN supports AND match_confidence < 0.50 THEN 'weak_suspicious'
      ELSE 'partial'
    END AS trust_signal
  FROM assess
)
"""

# ---------------- Per-table final projections (exact gold contract) ----------------
TABLES = {
    "facilities": f"""
WITH {BASE}
SELECT
  facility_id, name, type, district, state, state_code, beds, lat, lon,
  specialties, offers_surgery,
  CAST(NULL AS int) AS annual_surgeries,
  website_url,
  round(match_confidence, 4) AS match_confidence
FROM fac
""",
    "facility_capability_assessments": f"""
WITH {BASE},
{CAPS}
SELECT
  facility_id, capability, capability_label, capability_description, claimed,
  trust_signal,
  round(CASE WHEN NOT supports THEN 0.0 ELSE match_confidence END, 4) AS trust_score,
  -- evidence_count: number of real evidence rows this assessment will carry
  (CASE WHEN supports THEN 1 ELSE 0 END)
    + (CASE WHEN website_url IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN recent THEN 1 ELSE 0 END)
    + (CASE WHEN social >= 3 THEN 1 ELSE 0 END)
    + (CASE WHEN facts >= 10 THEN 1 ELSE 0 END)
    + (CASE WHEN NOT name_in_web AND website_url IS NOT NULL THEN 1 ELSE 0 END) AS evidence_count,
  (CASE WHEN supports THEN 1 ELSE 0 END)
    + (CASE WHEN name_in_web AND website_url IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN recent THEN 1 ELSE 0 END)
    + (CASE WHEN social >= 3 THEN 1 ELSE 0 END)
    + (CASE WHEN facts >= 10 THEN 1 ELSE 0 END) AS supporting_count,
  (CASE WHEN NOT name_in_web AND website_url IS NOT NULL THEN 1 ELSE 0 END) AS contradicting_count,
  CASE
    WHEN supports THEN 'Facility record - specialties / capability'
    ELSE 'Entity resolution'
  END AS best_source,
  CASE trust_signal
    WHEN 'strong' THEN capability_label || ' supported by on-record specialties and a corroborating official website.'
    WHEN 'partial' THEN capability_label || ' claimed on record; corroboration partial (website, recency or footprint incomplete).'
    WHEN 'weak_suspicious' THEN capability_label || ' claimed but the official website does not corroborate the facility name - needs human review.'
    ELSE 'No ' || capability_label || ' claim found in the facility record.'
  END AS summary
FROM signal
WHERE supports OR trust_signal <> 'no_claim'
""",
    # capability_evidence: one row per real corroborating/contradicting signal.
    "capability_evidence": f"""
WITH {BASE},
{CAPS},
claimed AS (SELECT * FROM signal WHERE supports)
SELECT * FROM (
  -- specialties / capability text
  SELECT facility_id, capability,
    facility_id || ':' || capability || ':spec' AS evidence_id,
    'facility_record' AS source_type, 'Facility record - specialties / capability' AS source_label,
    website_url AS source_url, 'supports' AS stance, round(match_confidence,3) AS weight,
    'On-record capability text: ' || left(coalesce(raw_capability, specialties), 280) AS snippet
  FROM claimed
  UNION ALL
  -- official website corroboration / contradiction (the headline signal)
  SELECT facility_id, capability,
    facility_id || ':' || capability || ':web',
    'website', CASE WHEN name_in_web THEN 'Official website (name corroborated)' ELSE 'Official website (name NOT corroborated)' END,
    website_url, CASE WHEN name_in_web THEN 'supports' ELSE 'contradicts' END, 0.4,
    CASE WHEN name_in_web
      THEN 'Official website ' || website_url || ' corroborates the facility name.'
      ELSE 'Official website ' || website_url || ' does not contain the facility name - possible mismatched/duplicated source.'
    END
  FROM claimed WHERE website_url IS NOT NULL
  UNION ALL
  -- page recency
  SELECT facility_id, capability, facility_id || ':' || capability || ':recency',
    'web_signal', 'Source page recency', website_url,
    CASE WHEN recent THEN 'supports' ELSE 'contradicts' END, 0.2,
    'Source page last updated: ' || coalesce(cast(recency AS string), 'unknown')
  FROM claimed WHERE recency IS NOT NULL
  UNION ALL
  -- digital footprint (social presence)
  SELECT facility_id, capability, facility_id || ':' || capability || ':social',
    'web_signal', 'Distinct social-media presence', website_url, 'supports', 0.15,
    cast(social AS string) || ' distinct social-media channels found for this facility.'
  FROM claimed WHERE social >= 3
  UNION ALL
  -- fact density on the org page
  SELECT facility_id, capability, facility_id || ':' || capability || ':facts',
    'web_signal', 'Structured facts on source page', website_url, 'supports', 0.15,
    cast(facts AS string) || ' structured facts extracted about this organization.'
  FROM claimed WHERE facts >= 10
) e
ORDER BY facility_id, capability
""",
    # geography: real NFHS-5 district indicators + real facility centroids.
    "geography": f"""
WITH {BASE},
centroid AS (
  SELECT district, state, avg(lat) AS lat, avg(lon) AS lon, count(*) AS n
  FROM base WHERE district IS NOT NULL AND state IS NOT NULL
  GROUP BY district, state
),
nfhs AS (
  SELECT lower(trim(district_name)) AS dkey, lower(trim(state_ut)) AS skey,
    fp_unmet_total_cm_w15_49_7_pct AS fp_unmet_pct,
    institutional_birth_5y_pct AS institutional_birth_pct,
    births_delivered_by_csection_5y_pct AS csection_pct,
    all_w15_49_who_are_anaemic_pct AS anaemia_pct
  FROM {VF}.nfhs_5_district_health_indicators
)
SELECT
  c.district, c.state, round(c.lat,5) AS lat, round(c.lon,5) AS lon,
  CAST(NULL AS bigint) AS population,
  CAST(NULL AS double) AS urbanity,
  n.fp_unmet_pct, n.institutional_birth_pct, n.csection_pct, n.anaemia_pct
FROM centroid c
LEFT JOIN nfhs n ON lower(c.district) = n.dkey AND lower(c.state) = n.skey
""",
}


def run_export(name: str, sql: str) -> int:
    payload = {
        "warehouse_id": WAREHOUSE,
        "statement": sql,
        "wait_timeout": "50s",
        "disposition": "EXTERNAL_LINKS",
        "format": "CSV",
    }
    res = subprocess.run(
        ["databricks", "api", "post", "/api/2.0/sql/statements", "-p", PROFILE,
         "--json", json.dumps(payload)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise SystemExit(f"[{name}] CLI error: {res.stderr[:800]}")
    d = json.loads(res.stdout)
    stmt_id = d.get("statement_id")
    # poll until finished
    while d.get("status", {}).get("state") in ("PENDING", "RUNNING"):
        g = subprocess.run(
            ["databricks", "api", "get", f"/api/2.0/sql/statements/{stmt_id}", "-p", PROFILE],
            capture_output=True, text=True,
        )
        d = json.loads(g.stdout)
    state = d.get("status", {}).get("state")
    if state != "SUCCEEDED":
        raise SystemExit(f"[{name}] SQL {state}: {json.dumps(d.get('status'))[:800]}")

    cols = [c["name"] for c in d["manifest"]["schema"]["columns"]]
    out_path = OUT / f"{name}.csv"
    total = 0
    with open(out_path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        # walk all chunks via external links
        chunk = d["result"]
        while True:
            for link in chunk.get("external_links", []):
                raw = fetch(link["external_link"])
                for row in csv.reader(io.StringIO(raw)):
                    if not row or row == cols:  # skip Databricks' per-export header row
                        continue
                    w.writerow(row)
                    total += 1
            nxt = chunk.get("external_links", [{}])[-1].get("next_chunk_index")
            if nxt is None:
                break
            g = subprocess.run(
                ["databricks", "api", "get",
                 f"/api/2.0/sql/statements/{stmt_id}/result/chunks/{nxt}", "-p", PROFILE],
                capture_output=True, text=True,
            )
            chunk = json.loads(g.stdout)
    print(f"[{name}] wrote {total:,} rows -> {out_path}")
    return total


if __name__ == "__main__":
    only = sys.argv[1:]
    for tname, tsql in TABLES.items():
        if only and tname not in only:
            continue
        run_export(tname, tsql)
    print("\nDone. Load with: make load-gold-real (or python -m src.load_gold_real)")
