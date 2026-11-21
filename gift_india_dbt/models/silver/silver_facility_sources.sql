{{
    config(
        materialized='view',
        schema='silver',
    )
}}

-- Union bronze facility reference sources into a common shape for MDM survivorship.
-- Virtue rows are the governed spine; JCI/NABH/PMJAY/NHPR/ABDM are reference registers.

with virtue as (
    select
        'virtue'::text                         as source_system,
        facility_id::text                      as source_id,
        name,
        type,
        district,
        state,
        lat,
        lon,
        beds,
        annual_surgeries,
        offers_surgery,
        specialties,
        website_url,
        match_confidence
    from {{ source('bronze', 'facilities_virtue') }}
),

jci as (
    select
        'jci'::text,
        jci_org_id,
        jci_name,
        null::text,
        coalesce(city, ''),
        state,
        null::double precision,
        null::double precision,
        null::integer,
        null::integer,
        null::boolean,
        ''::text,
        website_url,
        null::double precision
    from {{ source('bronze', 'facilities_jci') }}
    where state is not null and trim(state) != ''
),

nabh as (
    select
        'nabh'::text,
        nabh_org_id,
        nabh_name,
        null::text,
        coalesce(city, ''),
        state,
        lat,
        lng,
        null::integer,
        null::integer,
        null::boolean,
        ''::text,
        website_url,
        null::double precision
    from {{ source('bronze', 'facilities_nabh') }}
    where state is not null and trim(state) != ''
),

pmjay as (
    select
        'pmjay'::text,
        pmjay_org_id,
        pmjay_name,
        coalesce(hospital_type, 'Hospital'),
        coalesce(district, ''),
        state,
        lat,
        lng,
        coalesce(bed_strength, 0),
        null::integer,
        null::boolean,
        coalesce(specialties, ''),
        null::text,
        null::double precision
    from {{ source('bronze', 'facilities_pmjay') }}
    where state is not null and trim(state) != ''
),

nhpr as (
    select
        'nhpr'::text,
        nhpr_facility_id,
        facility_name,
        coalesce(facility_type, 'Hospital'),
        coalesce(district_name, ''),
        state_name,
        latitude,
        longitude,
        coalesce(total_beds, 0),
        null::integer,
        null::boolean,
        coalesce(specialities, ''),
        website_url,
        null::double precision
    from {{ source('bronze', 'locations_nhpr') }}
    where state_name is not null and trim(state_name) != ''
),

abdm as (
    select
        'abdm'::text,
        abdm_facility_id,
        facility_name,
        coalesce(facility_type, 'Healthcare Facility'),
        coalesce(district, ''),
        state,
        null::double precision,
        null::double precision,
        null::integer,
        null::integer,
        null::boolean,
        ''::text,
        null::text,
        null::double precision
    from {{ source('bronze', 'facilities_abdm') }}
    where state is not null and trim(state) != ''
)

select * from virtue
union all
select * from jci
union all
select * from nabh
union all
select * from pmjay
union all
select * from nhpr
union all
select * from abdm
