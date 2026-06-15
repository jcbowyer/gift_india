-- Bronze: NFHS-5 district health indicators, landed verbatim (wide format).
{{ config(materialized="table") }}

select
    *,
    current_timestamp() as _loaded_at
from {{ source('virtue_foundation', 'nfhs_5_district_health_indicators') }}
