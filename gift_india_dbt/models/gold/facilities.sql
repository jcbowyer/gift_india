{{
    config(
        materialized='table',
        schema='gold',
    )
}}

-- Gold facilities: serving table of geotagged facilities, linked to gold
-- geography by `geography_id` and to its district centroid by lat/lon. The
-- `distance_from_centroid_km` is the great-circle distance from the facility's
-- coordinates to its geography centroid (the lat/lon linkage), computed in SQL.

with facilities as (
    select * from {{ ref('silver_facilities') }}
),

geography as (
    select
        geography_id,
        district,
        state,
        lat as geo_lat,
        lon as geo_lon
    from {{ ref('geography') }}
)

select
    cast(f.facility_id as text)                            as facility_id,
    cast(f.name as text)                                   as name,
    cast(f.type as text)                                   as type,
    cast(g.geography_id as text)                           as geography_id,
    cast(f.district as text)                               as district,
    cast(f.state as text)                                  as state,
    cast(f.state_code as text)                             as state_code,
    cast(f.lat as double precision)                        as lat,
    cast(f.lon as double precision)                        as lon,
    cast(f.beds as integer)                                as beds,
    cast(f.annual_surgeries as integer)                    as annual_surgeries,
    cast(f.offers_surgery as boolean)                      as offers_surgery,
    cast(f.specialties as text)                            as specialties,
    cast(f.website_url as text)                            as website_url,
    cast(f.match_confidence as double precision)           as match_confidence,
    cast(
        round(
            ({{ haversine_km('f.lat', 'f.lon', 'g.geo_lat', 'g.geo_lon') }})::numeric,
            3
        ) as numeric
    )                                                      as distance_from_centroid_km
from facilities f
left join geography g
    on lower(f.district) = lower(g.district)
   and lower(f.state) = lower(g.state)
