-- Gold: EQUIPMENT catalog — distinct equipment descriptions with the number of
-- facilities that report each.
{{ config(materialized="table") }}

select
    {{ dbt_utils.generate_surrogate_key(['lower(equipment_text)']) }}
        as equipment_id,
    max(equipment_text)             as equipment_text,
    count(distinct facility_id)     as n_facilities
from {{ ref('silver_facility_equipment') }}
group by lower(equipment_text)
order by n_facilities desc
