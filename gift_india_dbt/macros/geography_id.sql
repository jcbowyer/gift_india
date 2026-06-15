{#
    Deterministic, human-readable surrogate key for a place:
    `<state_code>-<district-slug>` (lower-cased), e.g. `mh-mumbai`, `od-koraput`.
    Falls back to `xx` when the state code is unknown so the key is never null.
#}
{% macro geography_id(state_code, district) -%}
lower(
    coalesce({{ state_code }}, 'xx')
    || '-'
    || regexp_replace(
           regexp_replace({{ district }}, '[^a-zA-Z0-9]+', '-', 'g'),
           '(^-|-$)', '', 'g'
       )
)
{%- endmacro %}
