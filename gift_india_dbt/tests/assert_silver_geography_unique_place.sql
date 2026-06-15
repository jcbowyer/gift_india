-- Singular test: (district, state) must be unique in silver_geography.
-- Dependency-free alternative to dbt_utils.unique_combination_of_columns.
select
    lower(district) as district,
    lower(state)    as state,
    count(*)        as n
from {{ ref('silver_geography') }}
group by lower(district), lower(state)
having count(*) > 1
