{{
    config(
        materialized='view',
        schema='silver',
    )
}}

-- Gazetteer lookup: canonical state for any normalised place label.
-- Union of official state_codes names + hand-curated aliases for Virtue typos
-- and cities mis-labelled as states (Mumbai -> Maharashtra, etc.).

with codes as (
    select
        {{ geo_norm('state') }} as raw_norm,
        state                   as canonical_state,
        state_code
    from {{ ref('state_codes') }}
),

aliases as (
    select
        raw_norm,
        state as canonical_state,
        null::text as state_code
    from {{ ref('state_aliases') }}
),

combined as (
    select * from codes
    union all
    select a.*
    from aliases a
    left join codes c using (raw_norm)
    where c.raw_norm is null
)

select distinct on (raw_norm)
    raw_norm,
    canonical_state,
    state_code
from combined
order by raw_norm, state_code nulls last
