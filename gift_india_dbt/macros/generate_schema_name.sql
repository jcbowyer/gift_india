{#
    Use the configured `+schema` (silver / gold) as the *literal* schema name
    rather than dbt's default `<target_schema>_<custom>` prefixing. This keeps
    the medallion schemas named exactly `silver` and `gold` to match the
    architecture doc (docs/architecture/medallion-and-metric-store.md).
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- set default_schema = target.schema -%}
    {%- if custom_schema_name is none -%}
        {{ default_schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
