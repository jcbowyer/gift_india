/** Track 1 capability catalog — keys must match gift_india_dbt/seeds/capabilities.csv */

export interface CapabilityGuide {
  /** One sentence for planners — what clinical service line we are verifying. */
  headline: string;
  /** Concrete signals that support a claim (not an exhaustive clinical checklist). */
  whatCounts: readonly string[];
  /** How GIFT Gauge grades claims for this capability. */
  howWeGrade: string;
}

export const CAPABILITIES = [
  {
    key: 'icu',
    label: 'ICU',
    description: 'Adult intensive care: ventilators, monitored beds, intensivist cover.',
    guide: {
      headline:
        'Adult intensive care for critically ill patients who need continuous monitoring, organ support, and ventilator-capable beds.',
      whatCounts: [
        'Dedicated ICU or critical-care beds named on the facility website or registry',
        'Ventilator, monitor, or intensivist / critical-care language in official materials',
        'Specialties such as critical care medicine, anaesthesiology, or pulmonology on record',
      ],
      howWeGrade:
        'Each claim is scored from supporting vs contradicting pipeline evidence, source breadth, and name/website match confidence. Strong = multiple corroborating sources with little conflict; suspicious = thin, mixed, or contradictory evidence; no claim = facility does not assert this capability.',
    },
  },
  {
    key: 'maternity',
    label: 'Maternity',
    description: 'Labour & delivery, including emergency C-section capability.',
    guide: {
      headline:
        'Inpatient labour, delivery, and postpartum care — including the ability to perform emergency caesarean section when needed.',
      whatCounts: [
        'Maternity ward, labour room, or delivery suite listed on official channels',
        'Obstetrics / gynaecology services and newborn care mentioned together',
        'LSCS, C-section, or 24×7 maternity emergency language in facility materials',
      ],
      howWeGrade:
        'We corroborate claimed maternity services against website text, registry fields, and on-record specialties (e.g. gynaecology & obstetrics, neonatology). Strong claims have consistent, multi-source support; suspicious ones lack depth or show contradictions.',
    },
  },
  {
    key: 'emergency',
    label: 'Emergency',
    description: '24×7 casualty / emergency department with resuscitation.',
    guide: {
      headline:
        'Round-the-clock emergency or casualty care with resuscitation, triage, and stabilization for acute presentations.',
      whatCounts: [
        '24×7 emergency, casualty, or accident-&-emergency department on record',
        'Ambulance, triage, or emergency medicine services in official listings',
        'Emergency medicine, general surgery, or trauma-ready language in facility materials',
      ],
      howWeGrade:
        'Emergency claims are verified from explicit 24×7 wording, department names, and specialty corroboration. A single vague “emergency contact” line is weaker than a named casualty department with supporting specialties.',
    },
  },
  {
    key: 'oncology',
    label: 'Oncology',
    description: 'Cancer care: chemotherapy, and/or radiation or surgical oncology.',
    guide: {
      headline:
        'Cancer diagnosis and treatment — medical oncology (chemotherapy), radiation, and/or surgical oncology services.',
      whatCounts: [
        'Oncology, cancer centre, chemo, radiation, or onco-surgery named on the website',
        'Medical oncology, radiation oncology, or surgical oncology specialties listed',
        'Tumour board, day-care chemo, or linear accelerator / radiotherapy equipment mentioned',
      ],
      howWeGrade:
        'Oncology claims need clear cancer-treatment language, not just general medicine. We weight specialty lists and treatment-modality mentions; conflicting or generic “cancer care” without depth scores lower.',
    },
  },
  {
    key: 'trauma',
    label: 'Trauma',
    description: 'Trauma & accident care: imaging, OT, blood bank, trauma surgery.',
    guide: {
      headline:
        'Structured trauma and accident care — rapid imaging, operating theatre access, blood availability, and trauma surgery capability.',
      whatCounts: [
        'Trauma centre, accident & emergency, or polytrauma programme on official channels',
        'CT / imaging, blood bank, and operation theatre mentioned alongside trauma care',
        'Orthopaedics, general surgery, or emergency medicine specialties supporting trauma cover',
      ],
      howWeGrade:
        'Trauma claims are checked for accident-care infrastructure language, not just emergency room presence. Strong evidence ties trauma branding to imaging, OT, and surgical specialties; weak claims are generic “accident” mentions only.',
    },
  },
  {
    key: 'nicu',
    label: 'NICU',
    description: 'Neonatal intensive care for premature / critically ill newborns.',
    guide: {
      headline:
        'Neonatal intensive care for premature or critically ill newborns — incubator-level monitoring and neonatal critical care staffing.',
      whatCounts: [
        'NICU, neonatal ICU, or special newborn care unit named on the facility website',
        'Neonatology or paediatric critical-care specialties on record',
        'Ventilator / incubator / neonatal surgery language alongside maternity services',
      ],
      howWeGrade:
        'NICU is distinct from general paediatrics or maternity alone. We look for explicit neonatal ICU wording and neonatology corroboration; a maternity ward without NICU language typically scores as no claim or weak evidence.',
    },
  },
] as const;

export type CapabilityKey = (typeof CAPABILITIES)[number]['key'];

export type TrustSignal = 'strong' | 'partial' | 'weak_suspicious' | 'no_claim';
