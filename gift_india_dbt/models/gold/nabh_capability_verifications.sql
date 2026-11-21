{{
    config(
        materialized='table',
        schema='gold',
    )
}}

-- Gold: NABH certificate scope cross-referenced against Virtue capability claims.
-- Populated by ``make verify-nabh`` (bronze.nabh_capability_verifications).

select
    v.facility_id,
    f.name as facility_name,
    v.capability,
    c.label as capability_label,
    v.reference_no,
    v.nabh_org_id,
    v.virtue_claimed,
    v.virtue_trust_signal,
    v.virtue_trust_score,
    v.certificate_supports,
    v.certificate_scope_snippet,
    v.nabh_match_method,
    cast(v.nabh_match_confidence as numeric) as nabh_match_confidence,
    cast(v.splink_match_probability as numeric) as splink_match_probability,
    cast(v.verification_score as numeric) as verification_score,
    v.verification_signal,
    e.accreditation_program,
    e.valid_from as certificate_valid_from,
    e.valid_thru as certificate_valid_thru,
    e.parse_method,
    v.verified_at
from {{ source('bronze', 'nabh_capability_verifications') }} v
join {{ ref('facilities') }} f using (facility_id)
join {{ ref('capabilities') }} c using (capability)
left join {{ source('bronze', 'nabh_certificate_extractions') }} e
    on e.reference_no = v.reference_no
