{{
    config(
        materialized='table',
        schema='gold',
    )
}}

-- Gold geography: serving dimension of places (one row per district within a
-- state), keyed by `geography_id` and carrying the centroid lat/lon plus rolled
-- up facility counts. This is the geography that gold.facilities links to.

with geography as (
    select * from {{ ref('silver_geography') }}
),

facilities as (
    select * from {{ ref('silver_facilities') }}
),

facility_rollup as (
    select
        lower(district)                                   as district_key,
        lower(state)                                      as state_key,
        count(*)                                          as facility_count,
        count(*) filter (where offers_surgery)            as surgical_facility_count,
        sum(annual_surgeries)                             as annual_surgeries_total
    from facilities
    group by lower(district), lower(state)
)

select
    cast({{ geography_id('g.state_code', 'g.district') }} as text)  as geography_id,
    cast(g.district as text)                                        as district,
    cast(g.state as text)                                           as state,
    cast(g.state_code as text)                                      as state_code,
    cast(g.lat as double precision)                                 as lat,
    cast(g.lon as double precision)                                 as lon,
    cast(g.population as integer)                                   as population,
    cast(g.urbanity as double precision)                           as urbanity,
    cast(g.fp_unmet_pct as double precision)                       as fp_unmet_pct,
    cast(g.institutional_birth_pct as double precision)            as institutional_birth_pct,
    cast(g.csection_pct as double precision)                       as csection_pct,
    cast(g.anaemia_pct as double precision)                        as anaemia_pct,
    cast(coalesce(fr.facility_count, 0) as integer)                as facility_count,
    cast(coalesce(fr.surgical_facility_count, 0) as integer)       as surgical_facility_count,
    cast(coalesce(fr.annual_surgeries_total, 0) as integer)        as annual_surgeries_total
from geography g
left join facility_rollup fr
    on lower(g.district) = fr.district_key
   and lower(g.state) = fr.state_key
