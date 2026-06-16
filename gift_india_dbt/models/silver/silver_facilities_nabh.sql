{{
    config(
        materialized='view',
        schema='silver',
    )
}}

-- Silver facilities_nabh: cleaned, typed, deduped NABH-accredited / -certified /
-- -empanelled facilities in India. Trims text, attaches a state_code, and (re)derives
-- the canonical entity-resolution keys via the shared `jci_normalize` macro so NABH
-- and JCI keys are in lock-step with the matcher regardless of what the Python loader
-- landed. One row per `nabh_org_id`. Feeds gold.facility_nabh (the facility crosswalk).

with raw as (
    select * from {{ source('bronze', 'facilities_nabh') }}
),

state_codes as (
    select * from {{ ref('state_codes') }}
),

cleaned as (
    select
        trim(n.nabh_org_id)                             as nabh_org_id,
        trim(n.nabh_name)                               as nabh_name,
        nullif(trim(n.city), '')                        as city,
        nullif(trim(n.state), '')                       as state,
        sc.state_code                                   as state_code,
        nullif(trim(n.pincode), '')                     as pincode,
        coalesce(nullif(trim(n.country), ''), 'India')  as country,
        nullif(trim(n.accreditation_program), '')       as accreditation_program,
        nullif(trim(n.accreditation_status), '')        as accreditation_status,
        nullif(trim(n.reference_no), '')                as reference_no,
        nullif(trim(n.certificate_url), '')             as certificate_url,
        nullif(trim(n.address), '')                     as address,
        {{ jci_normalize('n.nabh_name') }}              as match_name,
        {{ jci_brand_key('n.nabh_name') }}              as brand_key,
        nullif(trim(n.website_url), '')                 as website_url,
        nullif(trim(n.phone), '')                       as phone,
        cast(n.lat as double precision)                 as lat,
        cast(n.lng as double precision)                 as lng,
        cast(coalesce(n.verified_on_portal, true) as boolean) as verified_on_portal,
        nullif(trim(n.source), '')                      as source,
        nullif(trim(n.source_url), '')                  as source_url,
        coalesce(nullif(trim(n.data_source), ''), 'nabh') as data_source,
        cast(n.collected_at as timestamp)               as collected_at
    from raw n
    left join state_codes sc
        on lower(trim(n.state)) = lower(sc.state)
    where nullif(trim(n.nabh_name), '') is not null
),

deduped as (
    select
        *,
        row_number() over (
            partition by nabh_org_id
            order by collected_at desc nulls last
        ) as _rn
    from cleaned
)

select
    nabh_org_id,
    nabh_name,
    city,
    state,
    state_code,
    pincode,
    country,
    accreditation_program,
    accreditation_status,
    reference_no,
    certificate_url,
    address,
    match_name,
    brand_key,
    website_url,
    phone,
    lat,
    lng,
    verified_on_portal,
    source,
    source_url,
    data_source,
    collected_at
from deduped
where _rn = 1
  and match_name <> ''
