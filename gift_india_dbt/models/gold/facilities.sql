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
--
-- `jci_accredited` is flagged by a LEFT JOIN to the gold.facility_jci crosswalk
-- (entity-resolved JCI-accredited orgs) at match confidence >= 0.70, with the
-- resolved org name + provenance (`jci_source`, `jci_data_source` = 'jci')
-- carried through so the accreditation is traceable to its source.
--
-- `nabh_accredited` is flagged the same way from the gold.facility_nabh crosswalk
-- (the full NABH national register), with the resolved org name, accreditation
-- status/programme, and provenance carried through. The two flags are independent:
-- a facility may be NABH-accredited, JCI-accredited, both, or neither.

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
),

jci as (
    select
        facility_id,
        jci_organization_name,
        match_method,
        match_confidence,
        jci_source,
        data_source as jci_data_source
    from {{ ref('facility_jci') }}
    where match_confidence >= 0.70
),

nabh as (
    select
        facility_id,
        nabh_organization_name,
        accreditation_status,
        accreditation_program,
        match_method,
        match_confidence,
        nabh_source,
        data_source as nabh_data_source
    from {{ ref('facility_nabh') }}
    where match_confidence >= 0.70
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
    )                                                      as distance_from_centroid_km,
    cast(j.facility_id is not null as boolean)             as jci_accredited,
    cast(j.jci_organization_name as text)                  as jci_organization_name,
    cast(j.match_method as text)                           as jci_match_method,
    cast(j.match_confidence as numeric)                    as jci_match_confidence,
    cast(j.jci_source as text)                             as jci_source,
    cast(j.jci_data_source as text)                        as jci_data_source,
    cast(nb.facility_id is not null as boolean)            as nabh_accredited,
    cast(nb.nabh_organization_name as text)                as nabh_organization_name,
    cast(nb.accreditation_status as text)                  as nabh_accreditation_status,
    cast(nb.accreditation_program as text)                 as nabh_accreditation_program,
    cast(nb.match_method as text)                          as nabh_match_method,
    cast(nb.match_confidence as numeric)                   as nabh_match_confidence,
    cast(nb.nabh_source as text)                           as nabh_source,
    cast(nb.nabh_data_source as text)                      as nabh_data_source
from facilities f
left join geography g
    on lower(f.district) = lower(g.district)
   and lower(f.state) = lower(g.state)
left join jci j
    on f.facility_id = j.facility_id
left join nabh nb
    on f.facility_id = nb.facility_id
