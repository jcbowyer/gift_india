{{
    config(
        materialized='view',
        schema='gold',
    )
}}

-- Gold MDM golden record — one survivorship row per master_facility_id.
-- Built from bronze source union + Splink cluster assignments. Virtue wins
-- for governed attributes; external registers fill gaps when Virtue is absent.

with linked as (
    select
        b.master_facility_id,
        b.cluster_method,
        b.member_count,
        s.source_system,
        s.source_id,
        s.name,
        s.type,
        s.district,
        s.state,
        s.lat,
        s.lon,
        s.beds,
        s.annual_surgeries,
        s.offers_surgery,
        s.specialties,
        s.website_url,
        s.match_confidence,
        case s.source_system
            when 'virtue' then 1
            when 'nabh' then 2
            when 'nhpr' then 3
            when 'pmjay' then 4
            when 'abdm' then 5
            when 'jci' then 6
            else 7
        end as source_rank
    from {{ ref('facility_master_bridge') }} b
    join {{ ref('silver_facility_sources') }} s
      on b.source_system = s.source_system
     and b.source_id = s.source_id
),

name_pick as (
    select distinct on (master_facility_id)
        master_facility_id,
        name as master_name,
        source_system as name_source
    from linked
    order by master_facility_id, source_rank, match_confidence desc nulls last, name
),

type_pick as (
    select distinct on (master_facility_id)
        master_facility_id,
        type as facility_type
    from linked
    where type is not null and trim(type) != ''
    order by master_facility_id, source_rank
),

geo_pick as (
    select distinct on (master_facility_id)
        master_facility_id,
        district,
        state,
        lat,
        lon
    from linked
    where lat is not null and lon is not null
    order by master_facility_id, source_rank, match_confidence desc nulls last
),

attrs as (
    select
        master_facility_id,
        max(beds) filter (where source_system = 'virtue') as beds,
        max(annual_surgeries) filter (where source_system = 'virtue') as annual_surgeries,
        bool_or(offers_surgery) filter (where source_system = 'virtue') as offers_surgery,
        max(specialties) filter (where source_system = 'virtue') as specialties,
        max(match_confidence) filter (where source_system = 'virtue') as match_confidence
    from linked
    group by master_facility_id
),

website_pick as (
    select distinct on (master_facility_id)
        master_facility_id,
        website_url
    from linked
    where website_url is not null and trim(website_url) != ''
    order by master_facility_id, source_rank
),

meta as (
    select
        master_facility_id,
        max(cluster_method) as cluster_method,
        max(member_count) as member_count
    from linked
    group by master_facility_id
)

select
    cast(m.master_facility_id as text)                         as master_facility_id,
    cast(n.master_name as text)                                as name,
    cast(n.name_source as text)                                as name_source,
    cast(coalesce(t.facility_type, 'Hospital') as text)        as type,
    cast(g.district as text)                                   as district,
    cast(g.state as text)                                      as state,
    cast(g.lat as double precision)                            as lat,
    cast(g.lon as double precision)                            as lon,
    cast(coalesce(a.beds, 0) as integer)                       as beds,
    cast(coalesce(a.annual_surgeries, 0) as integer)           as annual_surgeries,
    cast(coalesce(a.offers_surgery, false) as boolean)         as offers_surgery,
    cast(coalesce(nullif(trim(a.specialties), ''), '') as text) as specialties,
    cast(w.website_url as text)                                as website_url,
    cast(a.match_confidence as double precision)               as match_confidence,
    cast(m.cluster_method as text)                             as cluster_method,
    cast(m.member_count as integer)                            as member_count
from meta m
join name_pick n using (master_facility_id)
left join type_pick t using (master_facility_id)
left join geo_pick g using (master_facility_id)
left join attrs a using (master_facility_id)
left join website_pick w using (master_facility_id)
