-- Gold: CAPABILITIES catalog — distinct capability statements with the number
-- of facilities that report each.
{{ config(materialized="table") }}

select
    {{ dbt_utils.generate_surrogate_key(['lower(capability_text)']) }}
        as capability_id,
    max(capability_text)            as capability_text,
    count(distinct facility_id)     as n_facilities
from {{ ref('silver_facility_capabilities') }}
group by lower(capability_text)
order by n_facilities desc
