{{
    config(
        materialized='table',
        schema='gold',
    )
}}

-- Gold: citations backing each facility × capability assessment. Every snippet
-- is built from real gold.facilities column values — never fabricated text.

with assessments as (
    select * from {{ ref('facility_capability_assessments') }}
),

facilities as (
    select * from {{ ref('facilities') }}
),

-- Most-recent successful website crawl per facility (silver dedupes the bronze
-- crawl history). Empty until `make crawl` lands real pages, so the website
-- evidence below simply contributes zero rows in the synthetic dev dataset.
crawls as (
    select * from {{ ref('silver_facility_web_crawl') }}
),

-- Capability → distinctive page-text terms. A term appearing in the official
-- website's stripped text is a real, self-reported corroborating signal. Terms
-- are multi-character phrases to avoid boilerplate false positives.
capability_terms as (
    select * from (values
        ('maternity', 'maternity'),
        ('maternity', 'obstetric'),
        ('maternity', 'gynaec'),
        ('maternity', 'labour ward'),
        ('maternity', 'antenatal'),
        ('emergency', 'emergency department'),
        ('emergency', 'emergency care'),
        ('emergency', 'casualty'),
        ('emergency', 'accident and emergency'),
        ('trauma', 'trauma'),
        ('trauma', 'orthopaedic'),
        ('trauma', 'orthopedic'),
        ('oncology', 'oncology'),
        ('oncology', 'cancer'),
        ('oncology', 'chemotherapy'),
        ('oncology', 'radiotherapy'),
        ('icu', 'intensive care'),
        ('icu', 'critical care'),
        ('nicu', 'neonatal'),
        ('nicu', 'nicu')
    ) as t(capability, term)
),

base as (
    select
        a.facility_id,
        a.capability,
        a.claimed,
        f.name,
        f.type,
        f.specialties,
        f.beds,
        f.offers_surgery,
        f.match_confidence,
        f.website_url
    from assessments a
    join facilities f using (facility_id)
    where a.claimed or a.trust_signal <> 'no_claim'
),

specialty_evidence as (
    select
        facility_id,
        capability,
        facility_id || ':' || capability || ':specialties' as evidence_id,
        'facility_record' as source_type,
        'Facility record — specialties' as source_label,
        null::text as source_url,
        'supports' as stance,
        coalesce(match_confidence, 0.5) as weight,
        'Specialties on record: ' || coalesce(nullif(trim(specialties), ''), '(none listed)') as snippet
    from base
    where specialties is not null
      and trim(specialties) <> ''
      and (
          (capability = 'maternity' and (specialties ilike '%Obstetrics%' or specialties ilike '%Gynaecology%'))
          or (capability = 'trauma' and (
              specialties ilike '%Orthopaedics%' or specialties ilike '%General Surgery%' or specialties ilike '%Trauma%'
          ))
          or (capability = 'oncology' and (specialties ilike '%oncolog%' or specialties ilike '%cancer%'))
          or (capability = 'nicu' and (
              specialties ilike '%Paediatric%' or specialties ilike '%Pediatric%'
              or specialties ilike '%Neonatal%' or specialties ilike '%NICU%'
          ))
          or (capability = 'icu' and (
              specialties ilike '%critical%' or specialties ilike '%intensive%' or specialties ilike '%ICU%'
          ))
      )
),

type_evidence as (
    select
        facility_id,
        capability,
        facility_id || ':' || capability || ':type' as evidence_id,
        'facility_record' as source_type,
        'Facility record — facility type' as source_label,
        null::text as source_url,
        'supports' as stance,
        0.45 as weight,
        'Facility type on record: ' || type as snippet
    from base
    where claimed
),

beds_evidence as (
    select
        facility_id,
        capability,
        facility_id || ':' || capability || ':beds' as evidence_id,
        'facility_record' as source_type,
        'Facility record — bed count' as source_label,
        null::text as source_url,
        'supports' as stance,
        0.35 as weight,
        'Bed count on record: ' || beds::text as snippet
    from base
    where claimed and beds is not null
),

entity_evidence as (
    select
        facility_id,
        capability,
        facility_id || ':' || capability || ':entity' as evidence_id,
        'entity_resolution' as source_type,
        'Entity-resolution confidence score' as source_label,
        null::text as source_url,
        case when coalesce(match_confidence, 0) >= 0.65 then 'supports' else 'contradicts' end as stance,
        coalesce(match_confidence, 0) as weight,
        case
            when coalesce(match_confidence, 0) >= 0.65
                then 'Entity match confidence on record: ' || round(match_confidence::numeric, 3)::text
            else 'Entity match confidence on record: ' || round(match_confidence::numeric, 3)::text
                 || ' — below the 0.65 review threshold for high-stakes capability claims.'
        end as snippet
    from base
    where match_confidence is not null
),

website_evidence as (
    select
        facility_id,
        capability,
        facility_id || ':' || capability || ':website' as evidence_id,
        'facility_record' as source_type,
        'Facility record — website URL' as source_label,
        website_url as source_url,
        'supports' as stance,
        0.40 as weight,
        'Website URL on record: ' || website_url as snippet
    from base
    where website_url is not null and trim(website_url) <> ''
),

surgery_evidence as (
    select
        facility_id,
        capability,
        facility_id || ':' || capability || ':surgery' as evidence_id,
        'facility_record' as source_type,
        'Facility record — surgical services flag' as source_label,
        null::text as source_url,
        'supports' as stance,
        0.30 as weight,
        'Offers surgery on record: yes' as snippet
    from base
    where capability in ('trauma', 'emergency')
      and offers_surgery
),

-- Official website page text actually mentioning the capability. One evidence
-- row per (facility, capability): the alphabetically-first matching term wins,
-- and the snippet quotes a real ~160-char window of the crawled text around it
-- (whitespace-collapsed) — sourced, never fabricated.
website_text_evidence as (
    select distinct on (b.facility_id, b.capability)
        b.facility_id,
        b.capability,
        b.facility_id || ':' || b.capability || ':website_text' as evidence_id,
        'website_crawl' as source_type,
        'Official website — page text' as source_label,
        coalesce(c.final_url, c.website_url) as source_url,
        'supports' as stance,
        0.50 as weight,
        'Official website text: “…'
            || regexp_replace(
                 substring(
                     c.raw_text
                     from greatest(1, position(lower(ct.term) in lower(c.raw_text)) - 40)
                     for 160
                 ),
                 '\s+', ' ', 'g'
               )
            || '…”' as snippet
    from base b
    join crawls c
        on c.facility_id = b.facility_id
       and c.crawl_ok
       and c.raw_text is not null
    join capability_terms ct
        on ct.capability = b.capability
       and c.raw_text ilike '%' || ct.term || '%'
    order by b.facility_id, b.capability, ct.term
),

unioned as (
    select * from specialty_evidence
    union all select * from type_evidence
    union all select * from beds_evidence
    union all select * from entity_evidence
    union all select * from website_evidence
    union all select * from website_text_evidence
    union all select * from surgery_evidence
)

select
    evidence_id,
    facility_id,
    capability,
    source_type,
    source_label,
    source_url,
    stance,
    cast(weight as numeric) as weight,
    snippet,
    current_date as observed_at
from unioned
