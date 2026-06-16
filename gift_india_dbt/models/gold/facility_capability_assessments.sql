{{
    config(
        materialized='table',
        schema='gold',
    )
}}

-- Gold: per-facility × capability trust assessments for Track 1 (Governance, Integrity, & Facility Trust (GIFT) Desk).
-- Built ONLY from gold.facilities structured fields (specialties, type, beds,
-- offers_surgery, match_confidence, website_url). No fabricated citations —
-- evidence rows live in gold.capability_evidence.

with facilities as (
    select * from {{ ref('facilities') }}
),

capabilities as (
    select * from {{ ref('capabilities') }}
),

joined as (
    select
        f.facility_id,
        c.capability,
        c.label                                              as capability_label,
        c.description                                        as capability_description,
        f.name,
        f.type,
        f.specialties,
        f.beds,
        f.offers_surgery,
        f.match_confidence,
        f.website_url,

        -- Specialty substring matches (real values from the facility record).
        coalesce(f.specialties ilike '%Obstetrics%', false)
            or coalesce(f.specialties ilike '%Gynaecology%', false)           as spec_maternity,
        coalesce(f.specialties ilike '%Orthopaedics%', false)
            or coalesce(f.specialties ilike '%General Surgery%', false)
            or coalesce(f.specialties ilike '%Trauma%', false)                 as spec_trauma,
        coalesce(f.specialties ilike '%oncolog%', false)
            or coalesce(f.specialties ilike '%cancer%', false)                  as spec_oncology,
        coalesce(f.specialties ilike '%Paediatric%', false)
            or coalesce(f.specialties ilike '%Pediatric%', false)
            or coalesce(f.specialties ilike '%Neonatal%', false)
            or coalesce(f.specialties ilike '%NICU%', false)                   as spec_nicu,
        coalesce(f.specialties ilike '%critical%', false)
            or coalesce(f.specialties ilike '%intensive%', false)
            or coalesce(f.specialties ilike '%ICU%', false)                    as spec_icu,

        f.type in (
            'District Hospital', 'Medical College Hospital', 'Private Hospital'
        )                                                    as tier_hospital,
        f.type in (
            'District Hospital', 'Medical College Hospital', 'Community Health Centre',
            'Private Hospital', 'Charitable / Mission Hospital'
        )                                                    as tier_clinical

    from facilities f
    cross join capabilities c
),

claims as (
    select
        *,
        case capability
            when 'maternity' then spec_maternity
                or (tier_clinical and beds >= 10)
            when 'emergency' then tier_clinical or beds >= 5
            when 'trauma' then spec_trauma
                or (offers_surgery and tier_hospital)
            when 'oncology' then spec_oncology
                or (type = 'Medical College Hospital' and beds >= 80)
            when 'icu' then spec_icu
                or (tier_hospital and beds >= 50)
            when 'nicu' then spec_nicu
                or (spec_maternity and tier_hospital and beds >= 30)
                or (type = 'Medical College Hospital' and beds >= 100)
            else false
        end as claimed,

        case capability
            when 'maternity' then spec_maternity
            when 'emergency' then false
            when 'trauma' then spec_trauma
            when 'oncology' then spec_oncology
            when 'icu' then spec_icu
            when 'nicu' then spec_nicu
            else false
        end as specialty_supports,

        case capability
            when 'maternity' then tier_clinical and beds >= 10 and not spec_maternity
            when 'emergency' then tier_clinical and not spec_trauma
            when 'trauma' then offers_surgery and tier_hospital and not spec_trauma
            when 'oncology' then type = 'Medical College Hospital' and beds >= 80 and not spec_oncology
            when 'icu' then tier_hospital and beds >= 50 and not spec_icu
            when 'nicu' then (spec_maternity and tier_hospital and beds >= 30 and not spec_nicu)
                or (type = 'Medical College Hospital' and beds >= 100 and not spec_nicu)
            else false
        end as heuristic_supports_only

    from joined
),

scored as (
    select
        *,
        case
            when not claimed then 0.0
            else least(
                1.0,
                (case when specialty_supports then 0.55 else 0.0 end)
                + (case when heuristic_supports_only then 0.15 else 0.25 end)
                + coalesce(match_confidence, 0) * 0.35
                - (case when coalesce(match_confidence, 0) < 0.65 then 0.25 else 0.0 end)
            )
        end as trust_score,

        case
            when not claimed then 'no_claim'
            when coalesce(match_confidence, 0) < 0.60 and heuristic_supports_only then 'weak_suspicious'
            when specialty_supports and coalesce(match_confidence, 0) >= 0.80 then 'strong'
            when specialty_supports and coalesce(match_confidence, 0) >= 0.65 then 'partial'
            when claimed and coalesce(match_confidence, 0) < 0.65 then 'weak_suspicious'
            when claimed then 'partial'
            else 'no_claim'
        end as trust_signal
    from claims
)

select
    facility_id,
    capability,
    capability_label,
    capability_description,
    claimed,
    trust_signal,
    cast(round(trust_score::numeric, 4) as numeric) as trust_score,
    (
        (case when specialty_supports then 1 else 0 end)
        + (case when claimed and type is not null then 1 else 0 end)
        + (case when claimed and beds is not null then 1 else 0 end)
        + (case when match_confidence is not null then 1 else 0 end)
        + (case when website_url is not null and website_url <> '' then 1 else 0 end)
        + (case when coalesce(match_confidence, 0) < 0.65 and claimed then 1 else 0 end)
    )::integer as evidence_count,
    (
        (case when specialty_supports then 1 else 0 end)
        + (case when claimed and type is not null then 1 else 0 end)
        + (case when claimed and beds is not null then 1 else 0 end)
        + (case when match_confidence is not null then 1 else 0 end)
        + (case when website_url is not null and website_url <> '' then 1 else 0 end)
    )::integer as supporting_count,
    (
        case when coalesce(match_confidence, 0) < 0.65 and claimed then 1 else 0 end
    )::integer as contradicting_count,
    case
        when specialty_supports then 'Facility record — specialties'
        when type is not null then 'Facility record — type & scale'
        else 'Entity resolution'
    end as best_source,
    case trust_signal
        when 'strong' then capability_label || ' supported by on-record specialties and entity confidence.'
        when 'partial' then capability_label || ' inferred from facility type/scale; specialty match partial or confidence moderate.'
        when 'weak_suspicious' then capability_label || ' claim rests on weak heuristics and/or low entity-match confidence.'
        else 'No ' || capability_label || ' claim inferred from the facility record.'
    end as summary
from scored
