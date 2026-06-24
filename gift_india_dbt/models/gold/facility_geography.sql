{{
    config(
        materialized='table',
        schema='gold',
    )
}}

-- Gold facility ⇄ geography crosswalk: tiered entity resolution (mirrors facility_jci).
--
--   canonical_exact   1.00  canonical state + normalised district agree
--   source_exact      0.92  raw Virtue state + district agree
--   state_district    0.85  canonical state + loose district (contains)
--   spatial_state     0.78  nearest centroid within 50 km, same canonical state
--   spatial_nearest   0.62  nearest centroid within 75 km (any state)

with facilities as (
    select * from {{ ref('silver_facilities_resolved') }}
),

geography as (
    select * from {{ ref('silver_geography_resolved') }}
),

-- One representative row per geography_id (centroid + labels).
geo as (
    select distinct on (geography_id)
        geography_id,
        district,
        source_state,
        canonical_state,
        canonical_state_code,
        district_norm,
        lat,
        lon
    from geography
    order by geography_id, population desc nulls last
),

candidates as (
    -- Tier 1: canonical state + normalised district.
    select
        f.facility_id,
        g.geography_id,
        'canonical_exact'::text  as match_method,
        1.00::numeric            as match_confidence,
        {{ haversine_km('f.lat', 'f.lon', 'g.lat', 'g.lon') }} as distance_km,
        1                        as tier
    from facilities f
    join geo g
      on f.canonical_state = g.canonical_state
     and f.district_norm = g.district_norm

    union all

    -- Tier 2: raw Virtue labels match exactly.
    select
        f.facility_id,
        g.geography_id,
        'source_exact',
        0.92,
        {{ haversine_km('f.lat', 'f.lon', 'g.lat', 'g.lon') }},
        2
    from facilities f
    join geo g
      on lower(f.source_state) = lower(g.source_state)
     and lower(f.district) = lower(g.district)

    union all

    -- Tier 3: canonical state + district name overlap.
    select
        f.facility_id,
        g.geography_id,
        'state_district',
        0.85,
        {{ haversine_km('f.lat', 'f.lon', 'g.lat', 'g.lon') }},
        3
    from facilities f
    join geo g
      on f.canonical_state = g.canonical_state
     and (
         f.district_norm like '%' || g.district_norm || '%'
         or g.district_norm like '%' || f.district_norm || '%'
     )
     and length(g.district_norm) >= 3
     and length(f.district_norm) >= 3

    union all

    -- Tier 4: nearest centroid within 50 km, same canonical state.
    select
        f.facility_id,
        near.geography_id,
        'spatial_state'::text    as match_method,
        0.78::numeric            as match_confidence,
        near.distance_km,
        4                        as tier
    from facilities f
    join lateral (
        select
            g2.geography_id,
            {{ haversine_km('f.lat', 'f.lon', 'g2.lat', 'g2.lon') }} as distance_km
        from geo g2
        where f.canonical_state = g2.canonical_state
          and {{ haversine_km('f.lat', 'f.lon', 'g2.lat', 'g2.lon') }} <= 50
        order by 2
        limit 1
    ) near on true

    union all

    -- Tier 5: nearest centroid within 75 km (any state).
    select
        f.facility_id,
        near.geography_id,
        'spatial_nearest'::text    as match_method,
        0.62::numeric              as match_confidence,
        near.distance_km,
        5                          as tier
    from facilities f
    join lateral (
        select
            g2.geography_id,
            {{ haversine_km('f.lat', 'f.lon', 'g2.lat', 'g2.lon') }} as distance_km
        from geo g2
        where {{ haversine_km('f.lat', 'f.lon', 'g2.lat', 'g2.lon') }} <= 75
        order by 2
        limit 1
    ) near on true
),

ranked as (
    select
        *,
        row_number() over (
            partition by facility_id
            order by match_confidence desc, distance_km asc nulls last, tier asc
        ) as _rn
    from candidates
)

select
    facility_id,
    geography_id,
    match_method,
    match_confidence,
    round(distance_km::numeric, 3) as distance_km
from ranked
where _rn = 1
