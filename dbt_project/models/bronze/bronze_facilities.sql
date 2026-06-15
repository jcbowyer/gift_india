-- Bronze: land the Virtue Foundation facilities verbatim (source-native types,
-- no business logic). The capability columns stay as raw JSON-array strings so
-- silver extractions are always replayable against the original bytes.
{{ config(materialized="table") }}

select
    *,
    current_timestamp() as _loaded_at
from {{ source('virtue_foundation', 'facilities') }}
