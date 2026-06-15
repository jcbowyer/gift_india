-- Gold: per-facility capability profile — one serving row per facility that
-- rolls up the four exploded silver entities into counts plus the specialty
-- label set. This is the app/copilot-facing summary of what each facility does.
{{ config(materialized="table") }}

with spec as (
    select
        facility_id,
        count(*)                            as n_specialties,
        sort_array(collect_set(specialty_label)) as specialty_labels
    from {{ ref('silver_facility_specialties') }}
    group by facility_id
),

proc as (
    select facility_id, count(*) as n_procedures
    from {{ ref('silver_facility_procedures') }}
    group by facility_id
),

equip as (
    select facility_id, count(*) as n_equipment
    from {{ ref('silver_facility_equipment') }}
    group by facility_id
),

cap as (
    select facility_id, count(*) as n_capabilities
    from {{ ref('silver_facility_capabilities') }}
    group by facility_id
)

select
    f.facility_id,
    f.name,
    f.type,
    f.city,
    f.state,
    f.lat,
    f.lon,
    f.website_url,
    coalesce(spec.n_specialties, 0)     as n_specialties,
    coalesce(proc.n_procedures, 0)      as n_procedures,
    coalesce(equip.n_equipment, 0)      as n_equipment,
    coalesce(cap.n_capabilities, 0)     as n_capabilities,
    spec.specialty_labels
from {{ ref('silver_facilities') }} f
left join spec  on f.facility_id = spec.facility_id
left join proc  on f.facility_id = proc.facility_id
left join equip on f.facility_id = equip.facility_id
left join cap   on f.facility_id = cap.facility_id
