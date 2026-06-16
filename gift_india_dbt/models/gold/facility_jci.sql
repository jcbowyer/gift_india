{{
    config(
        materialized='table',
        schema='gold',
    )
}}

-- Gold facility ⇄ JCI crosswalk: the ENTITY-RESOLUTION reference table.
--
-- Source hospital names are messy ("Apollo Hospital, Chennai" vs "Apollo
-- Hospitals Enterprise Limited"), so we normalize both the JCI organization names
-- and the governed Virtue Foundation facility names to a comparable key (the
-- `jci_normalize` macro) and INNER JOIN them to resolve each JCI org to a single
-- `facility_id` — the standard identifier in the rest of the warehouse.
--
-- Matching is tiered by specificity, highest confidence wins per facility:
--   exact_name_state  1.00  normalized full name + state agree
--   brand_city        0.85  brand key + city=district + state agree
--   brand_state       0.70  brand key + state agree
-- Only HOSPITAL-type facilities are eligible (JCI accredits hospitals, not
-- clinics / health centres), which trims the obvious false positives — e.g. an
-- "Apollo Clinic" normalizes to the same "apollo" key as "Apollo Hospitals" but
-- is correctly excluded. Brand-only keys ("apollo", "wockhardt") still resolve at
-- state granularity, so `match_method` / `match_confidence` are kept for consumers
-- to tighten; gold.facilities flags `jci_accredited` at confidence >= 0.70.

with jci as (
    select * from {{ ref('silver_jci_accreditations') }}
),

facilities as (
    select
        facility_id,
        name,
        type,
        district,
        state,
        {{ jci_normalize('name') }}   as match_name,
        {{ jci_brand_key('name') }}   as brand_key
    from {{ ref('silver_facilities') }}
),

-- All candidate (facility, jci_org) pairs across the three matching tiers.
candidates as (
    -- Tier 1: exact normalized name + state.
    select
        f.facility_id, f.name as facility_name, f.district, f.state,
        j.jci_org_id, j.jci_name, j.accreditation_program, j.verified_on_portal,
        j.source, j.source_url, j.data_source, j.website_url, j.snapshot_dir,
        'exact_name_state'::text as match_method,
        1.00::numeric            as match_confidence
    from facilities f
    join jci j
      on f.match_name = j.match_name
     and lower(f.state) = lower(j.state)
    where f.match_name <> ''
      and f.type ilike '%hospital%'

    union all

    -- Tier 2: brand key + city(=district) + state, hospitals only.
    select
        f.facility_id, f.name, f.district, f.state,
        j.jci_org_id, j.jci_name, j.accreditation_program, j.verified_on_portal,
        j.source, j.source_url, j.data_source, j.website_url, j.snapshot_dir,
        'brand_city'::text, 0.85::numeric
    from facilities f
    join jci j
      on f.brand_key = j.brand_key
     and lower(f.district) = lower(j.city)
     and lower(f.state) = lower(j.state)
    where f.brand_key <> ''
      and f.type ilike '%hospital%'

    union all

    -- Tier 3: brand key + state, hospitals only.
    select
        f.facility_id, f.name, f.district, f.state,
        j.jci_org_id, j.jci_name, j.accreditation_program, j.verified_on_portal,
        j.source, j.source_url, j.data_source, j.website_url, j.snapshot_dir,
        'brand_state'::text, 0.70::numeric
    from facilities f
    join jci j
      on f.brand_key = j.brand_key
     and lower(f.state) = lower(j.state)
    where f.brand_key <> ''
      and f.type ilike '%hospital%'
),

-- One row per resolved facility: keep its single strongest JCI match.
ranked as (
    select
        *,
        row_number() over (
            partition by facility_id
            order by match_confidence desc, verified_on_portal desc, jci_name
        ) as _rn
    from candidates
)

select
    facility_id,
    facility_name,
    district,
    state,
    jci_org_id,
    jci_name                                  as jci_organization_name,
    accreditation_program,
    verified_on_portal,
    match_method,
    cast(match_confidence as numeric)         as match_confidence,
    source                                    as jci_source,
    source_url                                as jci_source_url,
    website_url                               as jci_website_url,
    snapshot_dir                              as jci_snapshot_dir,
    data_source
from ranked
where _rn = 1
