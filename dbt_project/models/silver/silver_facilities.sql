-- Silver: conform the raw facility record into a typed, canonical entity.
-- Source columns are all strings; we cast numerics with try_cast (bad values
-- become NULL rather than failing the build) and standardise column names.
{{ config(materialized="table") }}

with src as (
    select * from {{ ref('bronze_facilities') }}
),

-- The source carries a handful of duplicate unique_ids. Resolve to one row per
-- entity, preferring the richest record (has coordinates / website / contact),
-- then a stable tiebreak so the build is deterministic.
deduped as (
    select *
    from src
    qualify
        row_number() over (
            partition by unique_id
            order by
                (
                    cast(latitude is not null as int)
                    + cast(longitude is not null as int)
                    + cast(nullif(trim(officialWebsite), '') is not null as int)
                    + cast(nullif(trim(officialPhone), '') is not null as int)
                    + cast(nullif(trim(description), '') is not null as int)
                ) desc,
                name asc
        ) = 1
)

select
    unique_id                                  as facility_id,
    nullif(trim(name), '')                     as name,
    nullif(trim(organization_type), '')        as type,

    -- Location
    nullif(trim(address_city), '')             as city,
    nullif(trim(address_stateOrRegion), '')    as state,
    nullif(trim(address_zipOrPostcode), '')    as pincode,
    nullif(trim(address_country), '')          as country,
    nullif(trim(address_countryCode), '')      as country_code,
    latitude                                   as lat,
    longitude                                  as lon,

    -- Contact / web
    nullif(trim(officialWebsite), '')          as website_url,
    nullif(trim(officialPhone), '')            as phone,
    nullif(trim(email), '')                    as email,

    -- Attributes (typed)
    try_cast(yearEstablished as int)           as year_established,
    try_cast(numberDoctors as int)             as num_doctors,
    try_cast(capacity as int)                  as capacity_beds,
    nullif(trim(description), '')              as description,

    -- Provenance
    cluster_id,
    source,
    _loaded_at
from deduped
where unique_id is not null
