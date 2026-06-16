{{
    config(
        materialized='table',
        schema='gold',
    )
}}

-- Deterministic evidence strength for Track 1 ranking. The score is fully
-- reproducible in SQL; LLM narration (gold.capability_evidence_json/md) only
-- interprets the numbers — it never recomputes them.

with assessments as (
    select * from {{ ref('facility_capability_assessments') }}
),

facilities as (
    select * from {{ ref('facilities') }}
),

base as (
    select
        c.facility_id,
        c.capability,
        c.capability_label,
        c.capability_description,
        c.claimed,
        c.trust_signal,
        c.evidence_count,
        c.supporting_count,
        c.contradicting_count,
        c.best_source,
        c.summary,
        f.name as facility_name,
        f.type as facility_type,
        f.district as city,
        f.state,
        f.beds,
        f.website_url as website,
        f.specialties,
        f.match_confidence as facility_confidence,
        case
            when coalesce(c.claimed, false) then
                round(
                    (
                        (
                            0.45 * (
                                coalesce(
                                    c.supporting_count::numeric
                                    / nullif(c.supporting_count + c.contradicting_count, 0),
                                    0
                                )
                            )
                            + 0.25 * (least(coalesce(c.evidence_count, 0), 5)::numeric / 5.0)
                            + 0.30 * coalesce(f.match_confidence, 0)::numeric
                        ) * power(0.8::numeric, coalesce(c.contradicting_count, 0))
                    )::numeric,
                    3
                )
            else 0.0::numeric
        end as evidence_strength_score
    from assessments c
    join facilities f using (facility_id)
),

tiered as (
    select
        *,
        case
            when evidence_strength_score >= 0.85 then 'Strong'
            when evidence_strength_score >= 0.65 then 'Moderate'
            when evidence_strength_score >= 0.45 then 'Weak'
            else 'Insufficient'
        end as evidence_tier
    from base
)

select
    facility_id,
    facility_name,
    capability,
    capability_label,
    capability_description,
    claimed,
    trust_signal,
    evidence_count,
    supporting_count,
    contradicting_count,
    best_source,
    summary,
    facility_type,
    city,
    state,
    beds,
    website,
    specialties,
    facility_confidence,
    evidence_strength_score,
    evidence_tier,
    concat(
        'FACILITY',
        E'\n- id: ', facility_id,
        E'\n- name: ', facility_name,
        E'\n- type: ', facility_type,
        E'\n- location: ', city, ', ', state,
        E'\n- beds: ', beds::text,
        E'\n- official website: ', coalesce(website, ''),
        E'\n- name/website corroboration confidence: ', facility_confidence::text,
        E'\n- on-record specialties: ', coalesce(specialties, ''),
        E'\n\nCAPABILITY UNDER REVIEW',
        E'\n- capability: ', capability_label, ' (', capability, ')',
        E'\n- definition: ', capability_description,
        E'\n- claimed by facility: ', claimed::text,
        E'\n\nPIPELINE EVIDENCE (already computed — treat as ground truth, do not recompute)',
        E'\n- trust signal: ', trust_signal,
        E'\n- evidence items: ', evidence_count::text,
        ' (supporting: ', supporting_count::text,
        ', contradicting: ', contradicting_count::text, ')',
        E'\n- best source: ', coalesce(best_source, ''),
        E'\n- pipeline summary: ', coalesce(summary, ''),
        E'\n- evidence_strength_score: ', evidence_strength_score::text,
        E'\n- evidence_tier: ', evidence_tier
    ) as evidence_context
from tiered
