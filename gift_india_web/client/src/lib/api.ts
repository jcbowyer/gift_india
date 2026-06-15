export type RuralPreference = 'rural' | 'urban' | 'any';

export interface Specialty {
  specialty: string;
  facilities: number;
}

export interface Stats {
  districts: number;
  surgical_facilities: number;
  annual_surgeries: number;
  population_covered: number;
  desert_districts: number;
}

export interface Recommendation {
  rank: number;
  district: string;
  state: string;
  lat: number;
  lon: number;
  population: number;
  urbanity: number;
  specFacilities: number;
  specCapacity: number;
  anySurgicalFacilities: number;
  csectionPct: number | null;
  institutionalBirthPct: number | null;
  fpUnmetPct: number | null;
  anaemiaPct: number | null;
  needScore: number;
  gapScore: number;
  reachScore: number;
  score: number;
}

export interface RecommendResponse {
  specialty: string;
  ruralPreference: RuralPreference;
  results: Recommendation[];
}

export interface DistrictPoint {
  district: string;
  state: string;
  lat: number;
  lon: number;
  population: number;
  csection_pct: number | null;
  institutional_birth_pct: number | null;
  fp_unmet_pct: number | null;
  anaemia_pct: number | null;
  urbanity: number | null;
  surgical_facilities: number;
}

export interface PlacementPlan {
  id: number;
  created_by: string;
  team_label: string;
  specialty: string;
  rural_preference: string;
  team_size: number;
  days: number;
  district: string;
  state: string;
  score: number;
  population: number | null;
  created_at: string;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  whoami: () => getJSON<{ email: string }>('/api/whoami'),
  stats: () => getJSON<Stats>('/api/stats'),
  specialties: () => getJSON<Specialty[]>('/api/specialties'),
  districts: () => getJSON<DistrictPoint[]>('/api/districts'),
  recommend: (body: {
    specialty: string;
    ruralPreference: RuralPreference;
    teamSize: number;
    days: number;
    limit: number;
  }) => postJSON<RecommendResponse>('/api/recommend', body),
  plans: () => getJSON<PlacementPlan[]>('/api/plans'),
  savePlan: (body: {
    teamLabel: string;
    specialty: string;
    ruralPreference: string;
    teamSize: number;
    days: number;
    district: string;
    state: string;
    score: number;
    population?: number;
  }) => postJSON<PlacementPlan>('/api/plans', body),
  deletePlan: async (id: number) => {
    const res = await fetch(`/api/plans/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error(`${res.status} ${res.statusText}`);
  },
};

// Lightweight natural-language parsing of a free-text team description, e.g.
// "3-surgeon cataract team, 5 days, willing to travel rural".
const SPECIALTY_KEYWORDS: { match: RegExp; specialty: string }[] = [
  { match: /catarac|ophthalm|eye/i, specialty: 'Cataract / Ophthalmology' },
  { match: /obstetr|gynae|gyne|ob\/?gyn|maternal|c-?section/i, specialty: 'Obstetrics & Gynaecology' },
  { match: /orthop|bone|joint|fracture/i, specialty: 'Orthopaedics' },
  { match: /urolog|kidney|bladder/i, specialty: 'Urology' },
  { match: /cardia|heart|cardiac/i, specialty: 'Cardiac' },
  { match: /ent|ear|nose|throat/i, specialty: 'ENT' },
  { match: /cleft|plastic|reconstruct/i, specialty: 'Cleft & Plastic' },
  { match: /burn/i, specialty: 'Burns & Reconstruction' },
  { match: /paediatr|pediatr|child/i, specialty: 'Paediatric Surgery' },
  { match: /general surg|hernia|appendi/i, specialty: 'General Surgery' },
];

export interface ParsedTeam {
  specialty?: string;
  teamSize?: number;
  days?: number;
  ruralPreference?: RuralPreference;
}

export function parseTeamDescription(text: string): ParsedTeam {
  const out: ParsedTeam = {};
  for (const k of SPECIALTY_KEYWORDS) {
    if (k.match.test(text)) {
      out.specialty = k.specialty;
      break;
    }
  }
  const size = text.match(/(\d+)\s*(?:-|\s)?\s*(?:surgeon|surgeons|member|members|person|people|doctor|doctors)/i);
  if (size) out.teamSize = Math.min(50, parseInt(size[1], 10));
  const days = text.match(/(\d+)\s*(?:-|\s)?\s*(?:day|days|week|weeks)/i);
  if (days) {
    const n = parseInt(days[1], 10);
    out.days = /week/i.test(days[0]) ? Math.min(60, n * 7) : Math.min(60, n);
  }
  if (/rural|remote|village|underserved|desert/i.test(text)) out.ruralPreference = 'rural';
  else if (/urban|city|metro/i.test(text)) out.ruralPreference = 'urban';
  return out;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}
