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

unioned as (
    select * from specialty_evidence
    union all select * from type_evidence
    union all select * from beds_evidence
    union all select * from entity_evidence
    union all select * from website_evidence
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
