{#
  Turn a camelCase / PascalCase code into a human label.
  e.g. "orthopedicSurgery" -> "Orthopedic Surgery", "ophthalmology" -> "Ophthalmology".
  Inserts a space at lower->upper boundaries, then title-cases each word.
#}
{% macro humanize_camel_case(column) -%}
    initcap(
        trim(
            regexp_replace(
                regexp_replace({{ column }}, '([a-z0-9])([A-Z])', '$1 $2'),
                '([A-Z]+)([A-Z][a-z])', '$1 $2'
            )
        )
    )
{%- endmacro %}
