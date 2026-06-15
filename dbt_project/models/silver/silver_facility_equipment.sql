-- Silver transformation: EQUIPMENT.
-- The source `equipment` column is a JSON array of free-text equipment
-- descriptions. Parse → explode to one row per (facility, equipment item),
-- normalise whitespace, drop blanks, and dedupe exact repeats.
{{ config(materialized="table") }}

with exploded as (
    select
        f.unique_id                                  as facility_id,
        e.pos                                        as equipment_index,
        trim(regexp_replace(e.item, '\\s+', ' '))    as equipment_text
    from {{ ref('bronze_facilities') }} f
    lateral view posexplode(
        coalesce(from_json(f.equipment, 'array<string>'), array())
    ) e as pos, item
)

select
    {{ dbt_utils.generate_surrogate_key(['facility_id', 'equipment_text']) }}
        as facility_equipment_id,
    facility_id,
    equipment_index,
    equipment_text
from exploded
where equipment_text is not null
  and equipment_text <> ''
qualify
    row_number() over (
        partition by facility_id, lower(equipment_text)
        order by equipment_index
    ) = 1
