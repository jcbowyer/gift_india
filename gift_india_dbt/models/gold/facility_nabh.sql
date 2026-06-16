{{
    config(
        materialized='table',
        schema='gold',
    )
}}

-- Gold facility ⇄ NABH crosswalk: the ENTITY-RESOLUTION reference table for NABH.
--
-- Mirrors gold.facility_jci: source hospital names are messy, so we normalize both
-- the NABH organization names and the governed Virtue Foundation facility names to a
-- comparable key (the shared `jci_normalize` macro) and INNER JOIN them to resolve
-- each NABH org to a single `facility_id`.
--
-- Matching is tiered by specificity, highest confidence wins per facility:
--   exact_name_state  1.00  normalized full name + state agree
--   brand_city        0.85  brand key + city=district + state agree
--   brand_state       0.70  brand key + state agree
--
-- Unlike JCI (which accredits HOSPITALS only, so facility_jci filters to
-- `type ilike '%hospital%'`), NABH accredits the full spectrum — hospitals, small
-- healthcare organisations (SHCO ≈ clinics), eye-care, dental, AYUSH, blood banks,
-- imaging — so NO facility-type filter is applied here; clinics legitimately match.
-- That broadens recall but makes brand-only tiers more permissive, so
-- `match_method` / `match_confidence` are carried through for consumers to tighten;
-- gold.facilities flags `nabh_accredited` at confidence >= 0.70.
--
-- When several NABH programmes resolve to the same facility (e.g. an Accredited
-- hospital that also holds an empanelment), the strongest, most "accredited" row is
-- kept; the org's status/programme/reference travel with it for traceability.

with nabh as (
    select * from {{ ref('silver_nabh_accreditations') }}
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

-- All candidate (facility, nabh_org) pairs across the three matching tiers.
candidates as (
    -- Tier 1: exact normalized name + state (any facility type).
    select
        f.facility_id, f.name as facility_name, f.district, f.state,
        n.nabh_org_id, n.nabh_name, n.accreditation_program, n.accreditation_status,
        n.reference_no, n.certificate_url, n.verified_on_portal,
        n.source, n.source_url, n.data_source, n.website_url,
        'exact_name_state'::text as match_method,
        1.00::numeric            as match_confidence
    from facilities f
    join nabh n
      on f.match_name = n.match_name
     and lower(f.state) = lower(n.state)
    where f.match_name <> ''

    union all

    -- Tier 2: brand key + city(=district) + state.
    select
        f.facility_id, f.name, f.district, f.state,
        n.nabh_org_id, n.nabh_name, n.accreditation_program, n.accreditation_status,
        n.reference_no, n.certificate_url, n.verified_on_portal,
        n.source, n.source_url, n.data_source, n.website_url,
        'brand_city'::text, 0.85::numeric
    from facilities f
    join nabh n
      on f.brand_key = n.brand_key
     and lower(f.district) = lower(n.city)
     and lower(f.state) = lower(n.state)
    where f.brand_key <> ''

    union all

    -- Tier 3: brand key + state.
    select
        f.facility_id, f.name, f.district, f.state,
        n.nabh_org_id, n.nabh_name, n.accreditation_program, n.accreditation_status,
        n.reference_no, n.certificate_url, n.verified_on_portal,
        n.source, n.source_url, n.data_source, n.website_url,
        'brand_state'::text, 0.70::numeric
    from facilities f
    join nabh n
      on f.brand_key = n.brand_key
     and lower(f.state) = lower(n.state)
    where f.brand_key <> ''
),

-- One row per resolved facility: keep its single strongest NABH match. Ties broken
-- toward genuine accreditation (Accredited > Certified > Empaneled) then name.
ranked as (
    select
        *,
        row_number() over (
            partition by facility_id
            order by
                match_confidence desc,
                case lower(coalesce(accreditation_status, ''))
                    when 'accredited' then 0
                    when 'certified'  then 1
                    when 'empaneled'  then 2
                    else 3
                end,
                nabh_name
        ) as _rn
    from candidates
)

select
    facility_id,
    facility_name,
    district,
    state,
    nabh_org_id,
    nabh_name                                 as nabh_organization_name,
    accreditation_program,
    accreditation_status,
    reference_no                              as nabh_reference_no,
    certificate_url                           as nabh_certificate_url,
    verified_on_portal,
    match_method,
    cast(match_confidence as numeric)         as match_confidence,
    source                                    as nabh_source,
    source_url                                as nabh_source_url,
    website_url                               as nabh_website_url,
    data_source
from ranked
where _rn = 1
