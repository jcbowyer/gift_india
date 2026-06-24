-- Every facility should resolve to a geography row via the tiered crosswalk.
select f.facility_id
from {{ ref('silver_facilities_resolved') }} f
left join {{ ref('facility_geography') }} fg using (facility_id)
where fg.facility_id is null
