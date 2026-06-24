{{
    config(
        materialized='view',
        schema='silver',
    )
}}

-- Silver facilities with canonical state resolved via the gazetteer lookup.

with raw as (
    select * from {{ ref('silver_facilities') }}
),

lookup as (
    select * from {{ ref('silver_state_lookup') }}
),

codes as (
    select * from {{ ref('state_codes') }}
),

resolved as (
    select
        f.facility_id,
        f.name,
        f.type,
        f.district,
        f.state                                              as source_state,
        f.lat,
        f.lon,
        f.beds,
        f.annual_surgeries,
        f.offers_surgery,
        f.specialties,
        f.website_url,
        f.match_confidence,
        coalesce(
            sc_by_code.state,
            l_name.canonical_state,
            l_tail.canonical_state,
            sc_by_norm.state,
            f.state
        )                                                    as canonical_state,
        coalesce(
            sc_by_code.state_code,
            l_name.state_code,
            l_tail.state_code,
            sc_by_norm.state_code,
            f.state_code
        )                                                    as canonical_state_code,
        regexp_replace(
            replace(lower(trim(split_part(f.district, ',', 1))), '&', 'and'),
            '[^a-z0-9]', '', 'g'
        )                                                    as district_norm
    from raw f
    left join codes sc_by_code
        on f.state_code is not null
       and sc_by_code.state_code = f.state_code
    left join lookup l_name
        on regexp_replace(
               replace(lower(trim(split_part(f.state, ',', 1))), '&', 'and'),
               '[^a-z0-9]', '', 'g'
           ) = l_name.raw_norm
    left join lookup l_tail
        on regexp_replace(
               replace(lower(trim(split_part(f.state, ',', 2))), '&', 'and'),
               '[^a-z0-9]', '', 'g'
           ) = l_tail.raw_norm
    left join codes sc_by_norm
        on {{ geo_norm('f.state') }} = {{ geo_norm('sc_by_norm.state') }}
)

select * from resolved
