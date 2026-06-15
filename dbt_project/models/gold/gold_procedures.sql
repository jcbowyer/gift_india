-- Gold: PROCEDURES catalog — distinct procedure descriptions with the number
-- of facilities that report each. (Source text is free-form, so most phrasings
-- are facility-specific; the count surfaces the genuinely shared ones.)
{{ config(materialized="table") }}

select
    {{ dbt_utils.generate_surrogate_key(['lower(procedure_text)']) }}
        as procedure_id,
    max(procedure_text)             as procedure_text,
    count(distinct facility_id)     as n_facilities
from {{ ref('silver_facility_procedures') }}
group by lower(procedure_text)
order by n_facilities desc
