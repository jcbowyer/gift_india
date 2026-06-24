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
  guide: CapabilityGuide;
  claiming: number;
  strong: number;
  partial: number;
  weak: number;
  noClaim: number;
}

export interface CapabilityGuide {
  headline: string;
  whatCounts: readonly string[];
  howWeGrade: string;
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
  evidenceTier: string | null;
  evidenceCount: number;
  supportingCount: number;
  contradictingCount: number;
  bestSource: string;
  summary: string;
  overrideSignal: TrustSignal | null;
  overrideScore: number | null;
  overrideNote: string | null;
  /** Layer-2 narration or pipeline heuristic — planner should confirm locally. */
  reviewRecommended: boolean;
  reviewReason: string | null;
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
  region?: string | null;
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
  noClaim: number;
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
  region?: string | null;
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

export interface EvidenceCitation {
  source: string;
  stance: 'supporting' | 'contradicting' | 'contextual';
  detail: string;
}

export interface CapabilityAssessmentJson {
  facility_id: string;
  capability: string;
  verdict: 'Confirmed' | 'Likely' | 'Needs review' | 'Unsupported';
  evidence_tier: 'Strong' | 'Moderate' | 'Weak' | 'Insufficient';
  evidence_strength_score: number;
  rationale: string;
  specialty_corroboration?: string;
  citations: EvidenceCitation[];
  review_recommended: boolean;
  review_reason?: string;
}

export interface CapabilityDetail {
  key: string;
  label: string;
  description: string;
  claimed: boolean;
  trustSignal: TrustSignal;
  trustScore: number;
  evidenceTier: string | null;
  evidenceCount: number;
  supportingCount: number;
  contradictingCount: number;
  bestSource: string;
  summary: string;
  assessmentJson: CapabilityAssessmentJson | null;
  assessmentMd: string | null;
  /** Databricks serving endpoint or `stub/deterministic-template` when narrated. */
  assessmentModel: string | null;
  assessmentNarratedAt: string | null;
  overrideSignal: TrustSignal | null;
  overrideScore: number | null;
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
  original_score: number | null;
  override_score: number | null;
  note: string | null;
  created_at: string;
}

// ── data quality (web address coverage) ──────────────────────────────────────────────────────
export interface DataQualityStateRow {
  state: string;
  stateCode: string;
  total: number;
  withUrl: number;
  missing: number;
  pct: number;
  scrapeOk: number;
  scrapeTotal: number;
}

export interface DataQualityTypeRow {
  type: string;
  total: number;
  withUrl: number;
  missing: number;
  pct: number;
}

export interface DataQualityGeographyLevel {
  level: 'nation' | 'state' | 'district';
  label: string;
  name?: string;
  total: number;
  mapped: number;
  pct: number;
  facilities: number;
  withGeography: number;
  facilityPct: number;
}

export interface DataQualityGeographyStateRow {
  state: string;
  stateCode: string;
  totalDistricts: number;
  mappedDistricts: number;
  pct: number;
  stateMapped: boolean;
  facilities: number;
  withGeography: number;
  facilityPct: number;
}

export interface DataQualityGeography {
  overall: Omit<DataQualityGeographyLevel, 'level' | 'label' | 'name'> & {
    refStates?: number;
    mappedStates?: number;
    refDistricts?: number;
    mappedDistricts?: number;
  };
  levels: DataQualityGeographyLevel[];
  byState: DataQualityGeographyStateRow[];
}

export interface DataQualityReport {
  summary: {
    total: number;
    withUrl: number;
    pctWithUrl: number;
    missing: number;
    scrapeTotal: number;
    scrapeOk: number;
    scrapePct: number;
  };
  byGeography: DataQualityGeography;
  byState: DataQualityStateRow[];
  byType: DataQualityTypeRow[];
}

export interface DataQualityMissingFacility {
  facilityId: string;
  name: string;
  type: string | null;
  district: string;
  state: string;
  stateCode: string;
  beds: number | null;
}

export interface DataQualityUnmappedDistrict {
  district: string;
}

export interface DataQualityFlagSummary {
  byType: Record<string, number>;
  pendingMergeReviews: number;
  totalOpen: number;
}

export interface DataQualityFlag {
  id: number;
  facilityId: string;
  facilityName: string;
  flagType: string;
  severity: string;
  detail: string;
  relatedId: string | null;
  status: string;
  createdAt: string;
  state: string;
  stateCode: string;
  district: string;
}

export interface MergeCandidate {
  candidateId: string;
  leftSource: string;
  leftId: string;
  leftName: string;
  rightSource: string;
  rightId: string;
  rightName: string;
  matchProbability: number;
  matchWeight: number | null;
  state: string;
  district: string | null;
  recommendation: string;
  flagReason: string;
  computedAt: string;
  reviewDecision: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface MergeReviewRecord {
  id: number;
  candidateId: string;
  decision: string;
  reviewedBy: string;
  note: string | null;
  createdAt: string;
  leftSource: string;
  leftId: string;
  leftName: string;
  rightSource: string;
  rightId: string;
  rightName: string;
  matchProbability: number;
  recommendation: string;
}

export interface WebsiteUrlUpdateRecord {
  id: number;
  facilityId: string;
  facilityName: string;
  oldUrl: string | null;
  newUrl: string;
  reviewedBy: string;
  note: string | null;
  createdAt: string;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  whoami: () => getJSON<{ email: string }>('/api/whoami'),
  stats: () => getJSON<Stats>('/api/stats'),
  capabilities: () => getJSON<Capability[]>('/api/capabilities'),
  regions: () => getJSON<RegionState[]>('/api/regions'),
  mapGeography: (capability: string, params?: { region?: string; state?: string; includeDistricts?: boolean }) => {
    const qs = new URLSearchParams({ capability });
    if (params?.region) qs.set('region', params.region);
    if (params?.state) qs.set('state', params.state);
    if (params?.includeDistricts === false) qs.set('includeDistricts', 'false');
    return getJSON<MapGeography>(`/api/map/geography?${qs.toString()}`);
  },
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
    region?: string;
    state?: string;
    district?: string;
    signal?: TrustSignal;
    q?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set('capability', params.capability);
    if (params.region) qs.set('region', params.region);
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
  saveOverride: async (body: {
    facilityId: string;
    capability: string;
    overrideSignal: TrustSignal;
    overrideScore: number;
    note?: string;
  }): Promise<OverrideRecord | null> => {
    const res = await fetch('/api/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as OverrideRecord;
  },
  deleteOverride: async (id: number) => {
    const res = await fetch(`/api/overrides/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error(`${res.status} ${res.statusText}`);
  },
  dataQuality: () => getJSON<DataQualityReport>('/api/data-quality'),
  dataQualityMissing: (state?: string) =>
    getJSON<DataQualityMissingFacility[]>(
      `/api/data-quality/missing${state ? `?state=${encodeURIComponent(state)}` : ''}`,
    ),
  dataQualityUnmappedDistricts: (state: string) =>
    getJSON<DataQualityUnmappedDistrict[]>(
      `/api/data-quality/unmapped-districts?state=${encodeURIComponent(state)}`,
    ),
  dataQualityFlagSummary: () => getJSON<DataQualityFlagSummary>('/api/data-quality/flag-summary'),
  dataQualityFlags: (params?: { state?: string; type?: string }) => {
    const qs = new URLSearchParams();
    if (params?.state) qs.set('state', params.state);
    if (params?.type) qs.set('type', params.type);
    const q = qs.toString();
    return getJSON<DataQualityFlag[]>(`/api/data-quality/flags${q ? `?${q}` : ''}`);
  },
  dataQualityDuplicates: (state?: string) =>
    getJSON<MergeCandidate[]>(
      `/api/data-quality/duplicates${state ? `?state=${encodeURIComponent(state)}` : ''}`,
    ),
  saveMergeReview: async (body: { candidateId: string; decision: 'merge' | 'reject' | 'defer'; note?: string }) => {
    const res = await fetch('/api/data-quality/merge-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as MergeReviewRecord;
  },
  mergeReviews: () => getJSON<MergeReviewRecord[]>('/api/data-quality/merge-reviews'),
  saveWebsiteUrl: async (body: { facilityId: string; newUrl: string; note?: string }) => {
    const res = await fetch('/api/data-quality/website-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as WebsiteUrlUpdateRecord;
  },
  websiteUrlUpdates: () => getJSON<WebsiteUrlUpdateRecord[]>('/api/data-quality/website-url-updates'),
};

/** Default 0–1 trust score when a planner picks a signal in the override dialog. */
export const DEFAULT_SCORE_FOR_SIGNAL: Record<TrustSignal, number> = {
  strong: 0.9,
  partial: 0.75,
  weak_suspicious: 0.55,
  no_claim: 0,
};

export function effectiveTrustScore(item: { trustScore: number; overrideScore?: number | null }): number {
  return item.overrideScore ?? item.trustScore;
}

export function effectiveTrustSignal(item: {
  trustSignal: TrustSignal;
  overrideSignal?: TrustSignal | null;
}): TrustSignal {
  return item.overrideSignal ?? item.trustSignal;
}

export interface HumanReviewStatus {
  recommended: boolean;
  reason: string | null;
}

function heuristicHumanReviewReason(
  contradictingCount: number,
  trustSignal: TrustSignal,
): string | null {
  if (contradictingCount > 0) {
    return `${contradictingCount} contradicting evidence item${contradictingCount === 1 ? '' : 's'} on record.`;
  }
  if (trustSignal === 'weak_suspicious') {
    return 'Low trust signal — planner should confirm with local ground truth.';
  }
  return null;
}

/** Whether a capability still needs manual planner review (before an override clears the flag). */
export function humanReviewStatusForCapability(cap: CapabilityDetail): HumanReviewStatus {
  if (cap.overrideSignal) return { recommended: false, reason: null };
  if (cap.assessmentJson?.review_recommended) {
    return {
      recommended: true,
      reason: cap.assessmentJson.review_reason ?? 'Manual human review recommended.',
    };
  }
  const reason = heuristicHumanReviewReason(cap.contradictingCount, cap.trustSignal);
  return { recommended: reason !== null, reason };
}

/** Whether a ranked facility row still needs manual planner review. */
export function humanReviewStatusForRanking(rec: FacilityRanking): HumanReviewStatus {
  if (rec.overrideSignal) return { recommended: false, reason: null };
  if (rec.reviewRecommended) {
    return {
      recommended: true,
      reason: rec.reviewReason ?? 'Manual human review recommended.',
    };
  }
  const reason = heuristicHumanReviewReason(rec.contradictingCount, rec.trustSignal);
  return { recommended: reason !== null, reason };
}

export const STUB_NARRATION_MODEL = 'stub/deterministic-template';

/** Human-readable attribution for Layer 2 evidence cards (Agent Bricks vs dev stub). */
export function narrationAttribution(model: string | null): {
  isLlm: boolean;
  title: string;
  modelLabel: string | null;
} | null {
  if (!model) return null;
  if (model === STUB_NARRATION_MODEL) {
    return {
      isLlm: false,
      title: 'Pipeline template',
      modelLabel: null,
    };
  }
  const modelLabel = model.replace(/^databricks-/, '').replace(/-/g, ' ');
  return {
    isLlm: true,
    title: 'Databricks Agent Bricks',
    modelLabel,
  };
}

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
