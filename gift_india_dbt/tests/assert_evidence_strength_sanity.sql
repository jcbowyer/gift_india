-- Sanity check: known facilities must land at the expected tier/score band.
-- Aravind + Fortis Gurugram → 1.00 (Strong), RAM Kanpur → 0.92 (Strong),
-- Fortis Anandapur → ~0.66 (Moderate), Wockhardt Nagpur → ~0.61 (Weak).

with expected as (
    select * from (values
        ('b8a5401f-42f1-422a-8cd9-686a15b4cb76', 'maternity', 1.00, 'Strong'),
        ('06d5fb63-b2f1-4001-9c7c-a9fea7241dc3', 'maternity', 1.00, 'Strong'),
        ('59b6c976-2d44-4705-bcff-a83605983487', 'maternity', 0.92, 'Strong'),
        ('29b6dbe0-f471-4650-a488-10906b6ac873', 'maternity', 0.656, 'Moderate'),
        ('3ac5ae50-9ce2-4de3-a13c-d95a4ef218ee', 'maternity', 0.614, 'Weak')
    ) as t(facility_id, capability, expected_score, expected_tier)
)

select
    e.facility_id,
    e.capability,
    e.expected_score,
    s.evidence_strength_score,
    e.expected_tier,
    s.evidence_tier
from expected e
left join {{ ref('capability_scored') }} s
    on s.facility_id = e.facility_id
   and s.capability = e.capability
where s.facility_id is null
   or s.evidence_strength_score <> e.expected_score
   or s.evidence_tier <> e.expected_tier
