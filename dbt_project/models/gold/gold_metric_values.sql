-- Gold: METRIC VALUES — the row-based (long-format) metric store. Every wide
-- NFHS-5 district indicator column is pivoted from a column into a row, giving
-- one row per (district, metric). Adding a metric becomes "write more rows",
-- not a schema migration. See docs/architecture/medallion-and-metric-store.md §3.
--
-- The raw string value is preserved (NFHS-5 uses non-numeric markers like "(45)"
-- and "*" for small/suppressed samples); metric_value is a safe numeric cast that
-- is NULL when the source value is not a clean number.
{{ config(materialized="table") }}

with unpivoted as (
    {{ dbt_utils.unpivot(
        relation=ref('bronze_nfhs5_district_indicators'),
        cast_to='string',
        exclude=['district_name', 'state_ut'],
        remove=['_loaded_at'],
        field_name='metric_name',
        value_name='metric_value_text'
    ) }}
)

select
    {{ dbt_utils.generate_surrogate_key(['state_ut', 'district_name', 'metric_name']) }}
        as metric_value_id,
    {{ dbt_utils.generate_surrogate_key(['metric_name']) }}
        as metric_key,
    'district'                              as entity_type,
    nullif(trim(district_name), '')         as entity_id,
    nullif(trim(state_ut), '')              as state,
    metric_name,
    nullif(trim(metric_value_text), '')     as metric_value_text,
    try_cast(metric_value_text as double)   as metric_value,
    'nfhs5'                                 as source,
    cast(null as date)                      as as_of_date
from unpivoted
where nullif(trim(district_name), '') is not null
