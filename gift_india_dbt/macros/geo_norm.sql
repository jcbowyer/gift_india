{#
    Normalize an Indian place label for gazetteer / crosswalk joins.
    Lower-case, expand &, strip non-alphanumerics — mirrors client `normName`.
#}
{% macro geo_norm(col) -%}
regexp_replace(replace(lower(trim(coalesce({{ col }}, ''))), '&', 'and'), '[^a-z0-9]', '', 'g')
{%- endmacro %}


{#
    Strip a trailing ", <state>" suffix Virtue sometimes embeds in district/state
    fields (e.g. "Satara District, Maharashtra").
#}
{% macro geo_place_core(col) -%}
trim(split_part(coalesce({{ col }}, ''), ',', 1))
{%- endmacro %}
