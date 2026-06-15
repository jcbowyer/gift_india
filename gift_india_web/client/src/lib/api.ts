export type TrustSignal = 'strong' | 'partial' | 'weak_suspicious' | 'no_claim';

export interface Stats {
  facilities: number;
  states: number;
  assessed_claims: number;
  strong: number;
  suspicious: number;
  citations: number;
}

export interface Capability {
  key: string;
  label: string;
  description: string;
  claiming: number;
  strong: number;
  partial: number;
  weak: number;
  noClaim: number;
}

export interface DistrictRef {
  district: string;
  facilities: number;
}

export interface RegionState {
  state: string;
  stateCode: string;
  facilities: number;
  districts: DistrictRef[];
}

export interface FacilityRanking {
  rank: number;
  facilityId: string;
  name: string;
  type: string;
  district: string;
  state: string;
  stateCode: string;
  beds: number | null;
  websiteUrl: string;
  matchConfidence: number | null;
  claimed: boolean;
  trustSignal: TrustSignal;
  trustScore: number;
  evidenceCount: number;
  supportingCount: number;
  contradictingCount: number;
  bestSource: string;
  summary: string;
  overrideSignal: TrustSignal | null;
  overrideNote: string | null;
}

export interface FacilitiesResponse {
  capability: string;
  state: string | null;
  district: string | null;
  results: FacilityRanking[];
}

export interface EvidenceItem {
  evidenceId: string;
  sourceType: string;
  sourceLabel: string;
  sourceUrl: string;
  stance: 'supports' | 'contradicts';
  weight: number;
  snippet: string;
  observedAt: string;
}

export interface CapabilityDetail {
  key: string;
  label: string;
  description: string;
  claimed: boolean;
  trustSignal: TrustSignal;
  trustScore: number;
  evidenceCount: number;
  supportingCount: number;
  contradictingCount: number;
  bestSource: string;
  summary: string;
  overrideSignal: TrustSignal | null;
  overrideNote: string | null;
  evidence: EvidenceItem[];
}

export interface FacilityDetail {
  facility: {
    facilityId: string;
    name: string;
    type: string;
    district: string;
    state: string;
    stateCode: string;
    lat: number | null;
    lon: number | null;
    beds: number | null;
    websiteUrl: string;
    matchConfidence: number | null;
  };
  capabilities: CapabilityDetail[];
}

export interface OverrideRecord {
  id: number;
  facility_id: string;
  facility_name: string;
  capability: string;
  original_signal: string;
  override_signal: string;
  note: string | null;
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
  capabilities: () => getJSON<Capability[]>('/api/capabilities'),
  regions: () => getJSON<RegionState[]>('/api/regions'),
  facilities: (params: {
    capability: string;
    state?: string;
    district?: string;
    signal?: TrustSignal;
    q?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set('capability', params.capability);
    if (params.state) qs.set('state', params.state);
    if (params.district) qs.set('district', params.district);
    if (params.signal) qs.set('signal', params.signal);
    if (params.q) qs.set('q', params.q);
    if (params.limit) qs.set('limit', String(params.limit));
    return getJSON<FacilitiesResponse>(`/api/facilities?${qs.toString()}`);
  },
  facility: (id: string) => getJSON<FacilityDetail>(`/api/facilities/${encodeURIComponent(id)}`),
  overrides: () => getJSON<OverrideRecord[]>('/api/overrides'),
  saveOverride: (body: { facilityId: string; capability: string; overrideSignal: TrustSignal; note?: string }) =>
    postJSON<OverrideRecord>('/api/overrides', body),
  deleteOverride: async (id: number) => {
    const res = await fetch(`/api/overrides/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error(`${res.status} ${res.statusText}`);
  },
};

// ── trust-signal presentation helpers ───────────────────────────────────────
export const SIGNAL_META: Record<TrustSignal, { label: string; short: string; tone: string; dot: string }> = {
  strong: {
    label: 'Strong evidence',
    short: 'Strong',
    tone: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  partial: {
    label: 'Partial evidence',
    short: 'Partial',
    tone: 'bg-amber-100 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
  },
  weak_suspicious: {
    label: 'Weak / suspicious',
    short: 'Suspicious',
    tone: 'bg-red-100 text-red-800 border-red-200',
    dot: 'bg-red-500',
  },
  no_claim: {
    label: 'No claim',
    short: 'No claim',
    tone: 'bg-muted text-muted-foreground border-border',
    dot: 'bg-muted-foreground/40',
  },
};

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}
