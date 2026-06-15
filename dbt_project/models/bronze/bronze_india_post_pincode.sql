-- Bronze: India Post pincode directory, landed verbatim (reference data).
{{ config(materialized="table") }}

select
    *,
    current_timestamp() as _loaded_at
from {{ source('virtue_foundation', 'india_post_pincode_directory') }}
