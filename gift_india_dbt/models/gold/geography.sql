{{
    config(
        materialized='table',
        schema='gold',
    )
}}

-- Gold geography: serving dimension keyed by canonical `geography_id`.
-- Collapses messy Virtue spellings that resolve to the same canonical place.

with silver_geo as (
    select * from {{ ref('silver_geography_resolved') }}
),

-- One row per geography_id — prefer the richest population / NFHS record.
keyed as (
    select
        g.*,
        row_number() over (
            partition by geography_id
            order by population desc nulls last, length(district) desc
        ) as _rn
    from silver_geo g
),

geography as (
    select * from keyed where _rn = 1
),

links as (
    select geography_id, count(*) as facility_count
    from {{ ref('facility_geography') }}
    group by geography_id
),

facilities as (
    select * from {{ ref('silver_facilities_resolved') }}
),

surgical as (
    select
        fg.geography_id,
        count(*) filter (where f.offers_surgery)     as surgical_facility_count,
        sum(f.annual_surgeries)                      as annual_surgeries_total
    from {{ ref('facility_geography') }} fg
    join facilities f using (facility_id)
    group by fg.geography_id
)

select
    cast(g.geography_id as text)                                    as geography_id,
    cast(g.district as text)                                        as district,
    cast(g.canonical_state as text)                                 as state,
    cast(g.canonical_state_code as text)                            as state_code,
    cast(g.lat as double precision)                                 as lat,
    cast(g.lon as double precision)                                 as lon,
    cast(g.population as integer)                                   as population,
    cast(g.urbanity as double precision)                           as urbanity,
    cast(g.fp_unmet_pct as double precision)                       as fp_unmet_pct,
    cast(g.institutional_birth_pct as double precision)            as institutional_birth_pct,
    cast(g.csection_pct as double precision)                       as csection_pct,
    cast(g.anaemia_pct as double precision)                        as anaemia_pct,
    cast(coalesce(l.facility_count, 0) as integer)                 as facility_count,
    cast(coalesce(s.surgical_facility_count, 0) as integer)       as surgical_facility_count,
    cast(coalesce(s.annual_surgeries_total, 0) as integer)        as annual_surgeries_total
from geography g
left join links l using (geography_id)
left join surgical s using (geography_id)
