-- Silver transformation: PROCEDURES.
-- The source `procedure` column is a JSON array of free-text procedure
-- descriptions. Parse → explode to one row per (facility, procedure),
-- normalise whitespace, drop blanks, and dedupe exact repeats.
{{ config(materialized="table") }}

with exploded as (
    select
        f.unique_id                                  as facility_id,
        p.pos                                        as procedure_index,
        trim(regexp_replace(p.item, '\\s+', ' '))    as procedure_text
    from {{ ref('bronze_facilities') }} f
    lateral view posexplode(
        coalesce(from_json(f.procedure, 'array<string>'), array())
    ) p as pos, item
)

select
    {{ dbt_utils.generate_surrogate_key(['facility_id', 'procedure_text']) }}
        as facility_procedure_id,
    facility_id,
    procedure_index,
    procedure_text
from exploded
where procedure_text is not null
  and procedure_text <> ''
qualify
    row_number() over (
        partition by facility_id, lower(procedure_text)
        order by procedure_index
    ) = 1
