-- Silver transformation: SPECIALTIES.
-- The source `specialties` column is a JSON array of clean camelCase codes
-- (e.g. ["ophthalmology","orthopedicSurgery"]). Parse → explode to one row per
-- (facility, specialty), humanise the code into a label, and dedupe the
-- repeats the source carries.
{{ config(materialized="table") }}

with exploded as (
    select
        f.unique_id          as facility_id,
        s.pos                as specialty_index,
        trim(s.code)         as specialty_code
    from {{ ref('bronze_facilities') }} f
    lateral view posexplode(
        coalesce(from_json(f.specialties, 'array<string>'), array())
    ) s as pos, code
)

select
    {{ dbt_utils.generate_surrogate_key(['facility_id', 'specialty_code']) }}
        as facility_specialty_id,
    facility_id,
    specialty_code,
    {{ humanize_camel_case('specialty_code') }} as specialty_label
from exploded
where specialty_code is not null
  and specialty_code <> ''
qualify
    row_number() over (
        partition by facility_id, specialty_code
        order by specialty_index
    ) = 1
