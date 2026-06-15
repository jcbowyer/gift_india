-- Gold: METRIC dimension — one row per distinct metric tracked in the metric
-- store, with a friendly label, a thematic category, and an inferred unit. This
-- is the lookup side of the long-format store: gold_metric_values.metric_key ->
-- gold_metric. Built from the values so the catalog can never drift from what
-- is stored. Friendly labels + categories come from the metric_definitions seed;
-- any metric not yet in the seed falls back to a humanised label and the
-- 'Uncategorized' category so new source columns still surface.
{{ config(materialized="table") }}

with mv as (
    select metric_key, metric_name, entity_type, source, metric_value
    from {{ ref('gold_metric_values') }}
),

defs as (
    select metric_name, metric_label, metric_category
    from {{ ref('metric_definitions') }}
)

select
    mv.metric_key,
    mv.metric_name,
    coalesce(
        d.metric_label,
        initcap(replace(regexp_replace(mv.metric_name, '_pct$', ''), '_', ' '))
    )                                               as metric_label,
    coalesce(d.metric_category, 'Uncategorized')    as metric_category,
    case
        when endswith(mv.metric_name, '_pct')                                        then 'percent'
        when mv.metric_name like 'sex_ratio%' or contains(mv.metric_name, 'per_1000') then 'ratio'
        when contains(mv.metric_name, 'expenditure')                                 then 'inr'
        when contains(mv.metric_name, 'interviewed')
             or contains(mv.metric_name, 'surveyed')                                 then 'count'
        else 'value'
    end                                             as metric_unit,
    max(mv.entity_type)                             as entity_type,
    max(mv.source)                                  as source,
    count(*)                                        as n_values,
    count(mv.metric_value)                          as n_numeric_values
from mv
left join defs d on mv.metric_name = d.metric_name
group by mv.metric_key, mv.metric_name, d.metric_label, d.metric_category
order by metric_category, metric_label
