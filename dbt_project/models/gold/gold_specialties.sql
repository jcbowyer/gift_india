-- Gold: SPECIALTIES dimension — the distinct surgical/clinical specialties
-- offered across facilities, with coverage counts for the planner/copilot.
{{ config(materialized="table") }}

with fs as (
    select s.specialty_code, s.specialty_label, s.facility_id, f.state, f.city
    from {{ ref('silver_facility_specialties') }} s
    left join {{ ref('silver_facilities') }} f using (facility_id)
)

select
    specialty_code,
    max(specialty_label)            as specialty_label,
    count(distinct facility_id)     as n_facilities,
    count(distinct state)           as n_states,
    count(distinct city)            as n_cities
from fs
group by specialty_code
order by n_facilities desc
