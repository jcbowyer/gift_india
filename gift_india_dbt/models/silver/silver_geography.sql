{{
    config(
        materialized='view',
        schema='silver',
    )
}}

-- Silver geography: cleaned, typed, conformed district records.
-- One row per (district, state). Attaches `state_code`, validates coordinates,
-- and casts the NFHS-5 indicators to numeric. Feeds gold.geography.

with districts as (
    select * from {{ source('bronze', 'districts') }}
),

state_codes as (
    select * from {{ ref('state_codes') }}
),

cleaned as (
    select
        trim(d.district)                                     as district,
        trim(d.state)                                        as state,
        sc.state_code                                        as state_code,
        cast(d.lat as double precision)                      as lat,
        cast(d.lon as double precision)                      as lon,
        cast(d.population as integer)                        as population,
        cast(d.urbanity as double precision)                 as urbanity,
        cast(d.fp_unmet_pct as double precision)             as fp_unmet_pct,
        cast(d.institutional_birth_pct as double precision)  as institutional_birth_pct,
        cast(d.csection_pct as double precision)             as csection_pct,
        cast(d.anaemia_pct as double precision)              as anaemia_pct
    from districts d
    left join state_codes sc
        on lower(trim(d.state)) = lower(sc.state)
    where d.lat is not null
      and d.lon is not null
      and cast(d.lat as double precision) between -90 and 90
      and cast(d.lon as double precision) between -180 and 180
),

-- Defensive de-duplication on the natural key (keep the larger population row).
deduped as (
    select
        *,
        row_number() over (
            partition by lower(district), lower(state)
            order by population desc nulls last
        ) as _rn
    from cleaned
)

select
    district,
    state,
    state_code,
    lat,
    lon,
    population,
    urbanity,
    fp_unmet_pct,
    institutional_birth_pct,
    csection_pct,
    anaemia_pct
from deduped
where _rn = 1
