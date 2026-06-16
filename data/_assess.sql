-- Real-data trust engine validation: per-capability signal distribution.
WITH base AS (
  SELECT
    unique_id AS facility_id,
    name,
    officialWebsite AS website_url,
    lower(coalesce(specialties,'') || ' ' || coalesce(capability,'') || ' ' || coalesce(procedure,'')) AS evidence_text,
    try_cast(distinct_social_media_presence_count AS int) AS social,
    try_cast(number_of_facts_about_the_organization AS int) AS facts,
    affiliated_staff_presence = 'true' AS staff,
    try_cast(recency_of_page_update AS date) AS recency,
    lower(regexp_replace(officialWebsite,'[^A-Za-z]','')) AS web,
    filter(split(lower(regexp_replace(name,'[^A-Za-z ]','')),' '), w -> length(w) >= 5) AS name_words
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
  WHERE address_countryCode = 'IN'
),
enr AS (
  SELECT *,
    exists(name_words, w -> web LIKE '%'||w||'%') AS name_in_web,
    (recency >= add_months(current_date(), -24)) AS recent
  FROM base
),
mc AS (
  SELECT *,
    least(1.0, greatest(0.0,
        0.25
      + (CASE WHEN name_in_web THEN 0.30 ELSE 0.0 END)
      + (CASE WHEN recent THEN 0.15 ELSE 0.0 END)
      + (CASE WHEN social >= 3 THEN 0.10 ELSE 0.0 END)
      + (CASE WHEN facts >= 10 THEN 0.10 ELSE 0.0 END)
      + (CASE WHEN staff THEN 0.10 ELSE 0.0 END)
    )) AS match_confidence
  FROM enr
),
caps AS (
  SELECT * FROM VALUES
    ('maternity','obstetric|gynaec|gynec|maternity|labour|labor|delivery|obgyn|midwif'),
    ('emergency','emergency|casualty|accident|trauma|resuscitat|24x7|24/7'),
    ('trauma','trauma|orthop|fracture|accident|general surgery|surgery'),
    ('oncology','oncolog|cancer|chemo|radiation|tumou|tumor'),
    ('icu','icu|intensive|critical care|criticalcare|ventilat'),
    ('nicu','neonat|nicu|paediatric|pediatric|newborn')
  AS t(capability, pat)
),
assess AS (
  SELECT
    m.facility_id, c.capability,
    (m.evidence_text RLIKE c.pat) AS supports,
    m.name_in_web, m.match_confidence
  FROM mc m CROSS JOIN caps c
),
signal AS (
  SELECT *,
    CASE
      WHEN NOT supports THEN 'no_claim'
      WHEN supports AND name_in_web AND match_confidence >= 0.70 THEN 'strong'
      WHEN supports AND NOT name_in_web THEN 'weak_suspicious'
      WHEN supports AND match_confidence < 0.50 THEN 'weak_suspicious'
      ELSE 'partial'
    END AS trust_signal
  FROM assess
)
SELECT capability,
  count(*) total,
  sum(CASE WHEN trust_signal='strong' THEN 1 ELSE 0 END) strong,
  sum(CASE WHEN trust_signal='partial' THEN 1 ELSE 0 END) partial,
  sum(CASE WHEN trust_signal='weak_suspicious' THEN 1 ELSE 0 END) suspicious,
  sum(CASE WHEN trust_signal='no_claim' THEN 1 ELSE 0 END) no_claim
FROM signal GROUP BY capability ORDER BY capability
