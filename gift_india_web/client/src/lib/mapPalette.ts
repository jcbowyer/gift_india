import { scaleLinear, scaleSqrt } from 'd3-scale';
import type { TrustSignal } from './api';

/** Trust-signal → fill colour for facility pins (matches the trust palette). */
export const SIGNAL_COLORS: Record<TrustSignal, string> = {
  strong: '#10b981',
  partial: '#f59e0b',
  weak_suspicious: '#ef4444',
  no_claim: '#94a3b8',
};

/** Region rating (0–1 avg trust) → red→amber→green, or muted grey when unrated. */
const ratingScale = scaleLinear<string>()
  .domain([0, 0.45, 0.7, 1])
  .range(['#ef4444', '#f59e0b', '#84cc16', '#10b981'])
  .clamp(true);

export function ratingColor(avgScore: number | null): string {
  return avgScore === null ? '#e2e8f0' : ratingScale(avgScore);
}

/** Normalize an Indian state/district name for matching (data uses "&", topo uses "and"). */
export function normName(s: string): string {
  return s.toLowerCase().replace('&', 'and').replace(/[^a-z0-9]/g, '');
}

/** Display-case an ALL-CAPS SoI boundary name (e.g. "MORBI" → "Morbi"). */
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Spelling variants between the SoI boundaries and the data's district names. */
const NAME_ALIASES: Record<string, string> = {
  ahmadabad: 'ahmedabad', // SoI: AHMADABAD
  lahulandspiti: 'lahaulspiti', // SoI: LAHUL & SPITI
};
const canon = (n: string): string => NAME_ALIASES[n] ?? n;

/** Loose match between two place names (handles "Mumbai" vs "Mumbai Suburban"). */
export function placeMatch(a: string, b: string): boolean {
  const na = canon(normName(a));
  const nb = canon(normName(b));
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Map an SoI state boundary label (often ALL CAPS) to a canonical data state name. */
export function resolveBoundaryState(boundaryName: string, states: { state: string }[]): string {
  const hit = states.find((s) => placeMatch(s.state, boundaryName));
  return hit?.state ?? titleCase(boundaryName);
}

/** Map an SoI district boundary label to a canonical data district name within a state. */
export function resolveBoundaryDistrict(
  boundaryName: string,
  state: string,
  districts: { state: string; district: string }[],
): string {
  const inState = districts.filter((d) => placeMatch(d.state, state));
  const hit = inState.find((d) => placeMatch(d.district, boundaryName));
  return hit?.district ?? titleCase(boundaryName);
}

// ── colour ramps (low → high) ────────────────────────────────────────────────
export const RATING_RAMP = ['#ef4444', '#f59e0b', '#84cc16', '#10b981']; // red→green, rate metric
export const COUNT_RAMP = ['#e0e7ff', '#818cf8', '#312e81']; // indigo, built-in counts
export const STORE_RAMP = ['#dbeafe', '#3b82f6', '#1e3a8a']; // blue, metric-store values (Open Navigator style)

const logT = (v: number) => Math.log10(v + 1);

/** Screen-space radius bounds for facility-count bubbles (px, before zoom / k). */
export const BUBBLE_RADIUS = { min: 2.5, max: 9 } as const;

/** Cap bubble scale at this percentile so one outlier state does not dominate. */
export function facilityBubbleCap(counts: number[]): number {
  if (!counts.length) return 1;
  const sorted = [...counts].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.88));
  return Math.max(1, sorted[idx]);
}

/** Sqrt-of-log radius for a facility count within the current map scope. */
export function facilityBubbleRadius(count: number, maxInScope: number): number {
  const cap = Math.max(1, maxInScope);
  const sq = scaleSqrt().domain([0, logT(cap)]).range([BUBBLE_RADIUS.min, BUBBLE_RADIUS.max]);
  return sq(logT(Math.max(0, count)));
}

/** Three reference bubbles for the legend (low / mid / high facility counts). */
export function facilityBubbleLegendSamples(maxInScope: number): { count: number; r: number }[] {
  const cap = Math.max(1, maxInScope);
  const picks = [
    Math.max(1, Math.round(cap * 0.2)),
    Math.max(1, Math.round(cap * 0.55)),
    cap,
  ];
  return [...new Set(picks)].map((count) => ({ count, r: facilityBubbleRadius(count, cap) }));
}

// ── built-in Trust & Capacity metrics (computed from region roll-ups) ────────
export type BuiltinMetric = 'rating' | 'facilities' | 'strong' | 'claiming';

export interface RegionLike {
  avgScore: number | null;
  facilities: number;
  strong: number;
  claiming: number;
}

export function builtinValue(r: RegionLike, m: BuiltinMetric): number | null {
  switch (m) {
    case 'rating':
      return r.avgScore;
    case 'facilities':
      return r.facilities;
    case 'strong':
      return r.strong;
    case 'claiming':
      return r.claiming;
  }
}

/** Ramp + domain semantics for a metric, given whether it's the built-in rating. */
export function rampFor(source: 'builtin' | 'store', metricKey: string): { ramp: string[]; isRate: boolean } {
  if (source === 'store') return { ramp: STORE_RAMP, isRate: false };
  if (metricKey === 'rating') return { ramp: RATING_RAMP, isRate: true };
  return { ramp: COUNT_RAMP, isRate: false };
}

/** Min/max for the colour scale from metric values in the current geography scope. */
export function metricExtent(values: (number | null | undefined)[]): [number, number] | null {
  const nums = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (!nums.length) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  if (lo === hi) {
    const pad = Math.max(Math.abs(lo) * 0.05, lo === 0 ? 1 : 0.01);
    return [lo - pad, hi + pad];
  }
  return [lo, hi];
}
