{#
    Deterministic, human-readable surrogate key for a place:
    `<state_code>-<district-slug>` (lower-cased), e.g. `mh-mumbai`, `od-koraput`.

    When the state code is unknown (real VF data has ~200 messy/unmapped state
    spellings), fall back to a SLUG OF THE STATE NAME rather than a literal `xx`,
    so two same-named districts under different unmapped states don't collapse to
    the same key (which would violate the gold.geography primary key). `state` is
    optional for backwards-compatibility; pass it to get collision-safe fallbacks.
#}
{% macro geography_id(state_code, district, state=none) -%}
lower(
    coalesce(
        {{ state_code }},
        {% if state is not none -%}
        nullif(regexp_replace(
            regexp_replace({{ state }}, '[^a-zA-Z0-9]+', '-', 'g'),
            '(^-|-$)', '', 'g'
        ), ''),
        {%- endif %}
        'xx'
    )
    || '-'
    || regexp_replace(
           regexp_replace({{ district }}, '[^a-zA-Z0-9]+', '-', 'g'),
           '(^-|-$)', '', 'g'
       )
)
{%- endmacro %}
