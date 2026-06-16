{{
    config(
        materialized='view',
        schema='silver',
    )
}}

-- Silver facilities_jci: cleaned, typed, deduped JCI-accredited organizations
-- in India. Trims text, attaches a state_code, and (re)derives the canonical
-- entity-resolution keys via the `jci_normalize` macro so the keys are always in
-- lock-step with the matcher regardless of what the Python loader landed. One row
-- per `jci_org_id`. Feeds gold.facility_jci (the facility crosswalk).

with raw as (
    select * from {{ source('bronze', 'facilities_jci') }}
),

state_codes as (
    select * from {{ ref('state_codes') }}
),

cleaned as (
    select
        trim(j.jci_org_id)                              as jci_org_id,
        trim(j.jci_name)                                as jci_name,
        nullif(trim(j.city), '')                        as city,
        nullif(trim(j.state), '')                       as state,
        sc.state_code                                   as state_code,
        coalesce(nullif(trim(j.country), ''), 'India')  as country,
        nullif(trim(j.accreditation_program), '')       as accreditation_program,
        {{ jci_normalize('j.jci_name') }}               as match_name,
        {{ jci_brand_key('j.jci_name') }}               as brand_key,
        nullif(trim(j.website_url), '')                 as website_url,
        nullif(trim(j.snapshot_dir), '')                as snapshot_dir,
        cast(coalesce(j.verified_on_portal, false) as boolean) as verified_on_portal,
        nullif(trim(j.source), '')                      as source,
        nullif(trim(j.source_url), '')                  as source_url,
        coalesce(nullif(trim(j.data_source), ''), 'jci') as data_source,
        cast(j.collected_at as timestamp)               as collected_at
    from raw j
    left join state_codes sc
        on lower(trim(j.state)) = lower(sc.state)
    where nullif(trim(j.jci_name), '') is not null
),

deduped as (
    select
        *,
        row_number() over (
            partition by jci_org_id
            order by verified_on_portal desc, collected_at desc nulls last
        ) as _rn
    from cleaned
)

select
    jci_org_id,
    jci_name,
    city,
    state,
    state_code,
    country,
    accreditation_program,
    match_name,
    brand_key,
    website_url,
    snapshot_dir,
    verified_on_portal,
    source,
    source_url,
    data_source,
    collected_at
from deduped
where _rn = 1
  and match_name <> ''
