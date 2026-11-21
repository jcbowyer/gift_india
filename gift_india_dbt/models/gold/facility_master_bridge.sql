{{
    config(
        materialized='view',
        schema='gold',
    )
}}

-- Source-system ↔ master_facility_id crosswalk from Splink MDM clusters.
-- Populated by `make apply-merge-clusters` after human merge reviews.

select
    cast(source_system as text)        as source_system,
    cast(source_id as text)            as source_id,
    cast(master_facility_id as text)   as master_facility_id,
    cast(cluster_method as text)       as cluster_method,
    cast(member_count as integer)      as member_count,
    built_at
from {{ source('bronze', 'facility_clusters') }}
