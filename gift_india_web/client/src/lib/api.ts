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
  lat: number | null;
  lon: number | null;
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

export interface FacilitySearchResult {
  facilityId: string;
  name: string;
  type: string;
  district: string;
  state: string;
  stateCode: string;
  beds: number | null;
}

export interface FacilitiesResponse {
  capability: string;
  state: string | null;
  district: string | null;
  results: FacilityRanking[];
}

// ── drilldown map: region rating roll-ups ────────────────────────────────────
export interface RegionRating {
  facilities: number;
  claiming: number;
  avgScore: number | null;
  strong: number;
  partial: number;
  weak: number;
}

export interface StateRating extends RegionRating {
  state: string;
  stateCode: string;
}

export interface DistrictRating extends RegionRating {
  state: string;
  district: string;
  stateCode: string;
  lat: number | null;
  lon: number | null;
  population: number | null;
}

export interface MapGeography {
  capability: string;
  states: StateRating[];
  districts: DistrictRating[];
}

// ── metric catalog (navigator left panel) ────────────────────────────────────
export type MetricSource = 'builtin' | 'store';

export interface CatalogMetric {
  key: string;
  name?: string;
  label: string;
  category: string;
  unit: string;
  source: MetricSource;
}

export interface CatalogGroup {
  category: string;
  builtin: boolean;
  metrics: CatalogMetric[];
}

export interface MetricCatalog {
  groups: CatalogGroup[];
  storeAvailable: boolean;
}

export interface MetricValueRow {
  state: string;
  district: string;
  value: number;
}

export interface MetricValues {
  key: string;
  districts: MetricValueRow[];
}

// ── area scorecard ───────────────────────────────────────────────────────────
export type ScorecardLevel = 'nation' | 'state' | 'district';
export type Benchmark = 'nation' | 'region' | 'state';

export interface ScorecardMetricValues {
  value: number | null;
  nation: number | null;
  region: number | null;
  state: number | null;
}

export interface Scorecard {
  area: {
    level: ScorecardLevel;
    name: string;
    state: string | null;
    district: string | null;
    region: string | null;
    population: number;
    facilities: number;
    districtCount: number;
  };
  benchmarks: Record<Benchmark, boolean>;
  metrics: Record<string, ScorecardMetricValues>;
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
  mapGeography: (capability: string) =>
    getJSON<MapGeography>(`/api/map/geography?capability=${encodeURIComponent(capability)}`),
  metricCatalog: () => getJSON<MetricCatalog>('/api/metrics/catalog'),
  metricValues: (key: string) => getJSON<MetricValues>(`/api/metrics/values?key=${encodeURIComponent(key)}`),
  scorecard: (params: { level: ScorecardLevel; state?: string; district?: string }) => {
    const qs = new URLSearchParams({ level: params.level });
    if (params.state) qs.set('state', params.state);
    if (params.district) qs.set('district', params.district);
    return getJSON<Scorecard>(`/api/scorecard?${qs.toString()}`);
  },
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
  facilitySearch: (q?: string) =>
    getJSON<FacilitySearchResult[]>(`/api/facilities/search${q ? `?q=${encodeURIComponent(q)}` : ''}`),
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
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}m`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}k`;
  }
  return `${n}`;
}
