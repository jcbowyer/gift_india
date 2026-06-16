{{
    config(
        materialized='view',
        schema='silver',
    )
}}

-- Silver geography with canonical state / state_code resolved via the gazetteer.
-- Preserves Virtue source labels for audit; downstream gold keys on canonical names.

with raw as (
    select * from {{ ref('silver_geography') }}
),

lookup as (
    select * from {{ ref('silver_state_lookup') }}
),

codes as (
    select * from {{ ref('state_codes') }}
),

resolved as (
    select
        r.district,
        r.state                                              as source_state,
        r.lat,
        r.lon,
        r.population,
        r.urbanity,
        r.fp_unmet_pct,
        r.institutional_birth_pct,
        r.csection_pct,
        r.anaemia_pct,
        coalesce(
            sc_by_code.state,
            l_name.canonical_state,
            l_tail.canonical_state,
            sc_by_norm.state,
            r.state
        )                                                    as canonical_state,
        coalesce(
            sc_by_code.state_code,
            l_name.state_code,
            l_tail.state_code,
            sc_by_norm.state_code,
            r.state_code
        )                                                    as canonical_state_code,
        regexp_replace(
            replace(lower(trim(split_part(r.district, ',', 1))), '&', 'and'),
            '[^a-z0-9]', '', 'g'
        )                                                    as district_norm
    from raw r
    left join codes sc_by_code
        on r.state_code is not null
       and sc_by_code.state_code = r.state_code
    left join lookup l_name
        on regexp_replace(
               replace(lower(trim(split_part(r.state, ',', 1))), '&', 'and'),
               '[^a-z0-9]', '', 'g'
           ) = l_name.raw_norm
    left join lookup l_tail
        on regexp_replace(
               replace(lower(trim(split_part(r.state, ',', 2))), '&', 'and'),
               '[^a-z0-9]', '', 'g'
           ) = l_tail.raw_norm
    left join codes sc_by_norm
        on {{ geo_norm('r.state') }} = {{ geo_norm('sc_by_norm.state') }}
)

select
    district,
    source_state,
    canonical_state,
    canonical_state_code,
    district_norm,
    lat,
    lon,
    population,
    urbanity,
    fp_unmet_pct,
    institutional_birth_pct,
    csection_pct,
    anaemia_pct,
    {{ geography_id('canonical_state_code', 'district', 'canonical_state') }} as geography_id
from resolved
