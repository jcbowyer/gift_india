-- Silver transformation: CAPABILITIES.
-- The source `capability` column is a JSON array of free-text capability
-- statements (services, accreditations, departments, facts). Parse → explode
-- to one row per (facility, capability), normalise whitespace, drop blanks,
-- and dedupe exact repeats.
{{ config(materialized="table") }}

with exploded as (
    select
        f.unique_id                                  as facility_id,
        c.pos                                        as capability_index,
        trim(regexp_replace(c.item, '\\s+', ' '))    as capability_text
    from {{ ref('bronze_facilities') }} f
    lateral view posexplode(
        coalesce(from_json(f.capability, 'array<string>'), array())
    ) c as pos, item
)

select
    {{ dbt_utils.generate_surrogate_key(['facility_id', 'capability_text']) }}
        as facility_capability_id,
    facility_id,
    capability_index,
    capability_text
from exploded
where capability_text is not null
  and capability_text <> ''
qualify
    row_number() over (
        partition by facility_id, lower(capability_text)
        order by capability_index
    ) = 1
