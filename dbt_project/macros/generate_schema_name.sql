{#
  Use the model's configured `+schema` verbatim as the schema name, instead of
  dbt's default `<target_schema>_<custom_schema>`. This gives us clean medallion
  schemas (gift_india_bronze / _silver / _gold) under the target catalog.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema | trim }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
