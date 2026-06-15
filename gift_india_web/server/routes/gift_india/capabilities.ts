/** Track 1 capability catalog — keys must match gift_india_dbt/seeds/capabilities.csv */
export const CAPABILITIES = [
  { key: 'icu', label: 'ICU', description: 'Adult intensive care: ventilators, monitored beds, intensivist cover.' },
  { key: 'maternity', label: 'Maternity', description: 'Labour & delivery, including emergency C-section capability.' },
  { key: 'emergency', label: 'Emergency', description: '24×7 casualty / emergency department with resuscitation.' },
  { key: 'oncology', label: 'Oncology', description: 'Cancer care: chemotherapy, and/or radiation or surgical oncology.' },
  { key: 'trauma', label: 'Trauma', description: 'Trauma & accident care: imaging, OT, blood bank, trauma surgery.' },
  { key: 'nicu', label: 'NICU', description: 'Neonatal intensive care for premature / critically ill newborns.' },
] as const;

export type CapabilityKey = (typeof CAPABILITIES)[number]['key'];

export type TrustSignal = 'strong' | 'partial' | 'weak_suspicious' | 'no_claim';
