{{
    config(
        materialized='view',
        schema='silver',
    )
}}

-- Silver facilities: cleaned, typed, conformed facility records.
-- Trims text, attaches `state_code`, coerces numerics/booleans, validates
-- coordinates, and entity-resolves duplicate `facility_id`s to the row with the
-- highest `match_confidence`. Feeds gold.facilities.

with facilities as (
    select * from {{ source('bronze', 'facilities_virtue') }}
),

state_codes as (
    select * from {{ ref('state_codes') }}
),

cleaned as (
    select
        trim(f.facility_id)                                    as facility_id,
        trim(f.name)                                           as name,
        trim(f.type)                                           as type,
        trim(f.district)                                       as district,
        trim(f.state)                                          as state,
        sc.state_code                                          as state_code,
        cast(f.lat as double precision)                        as lat,
        cast(f.lon as double precision)                        as lon,
        cast(coalesce(f.beds, 0) as integer)                   as beds,
        cast(coalesce(f.annual_surgeries, 0) as integer)       as annual_surgeries,
        cast(coalesce(f.offers_surgery, false) as boolean)     as offers_surgery,
        coalesce(nullif(trim(f.specialties), ''), '')          as specialties,
        nullif(trim(f.website_url), '')                        as website_url,
        cast(f.match_confidence as double precision)           as match_confidence
    from facilities f
    left join state_codes sc
        on lower(trim(f.state)) = lower(sc.state)
    where f.lat is not null
      and f.lon is not null
      and cast(f.lat as double precision) between -90 and 90
      and cast(f.lon as double precision) between -180 and 180
),

deduped as (
    select
        *,
        row_number() over (
            partition by facility_id
            order by match_confidence desc nulls last
        ) as _rn
    from cleaned
)

select
    facility_id,
    name,
    type,
    district,
    state,
    state_code,
    lat,
    lon,
    beds,
    annual_surgeries,
    offers_surgery,
    specialties,
    website_url,
    match_confidence
from deduped
where _rn = 1
