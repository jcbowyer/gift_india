import { scaleLinear } from 'd3-scale';
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

// ── colour ramps (low → high) ────────────────────────────────────────────────
export const RATING_RAMP = ['#ef4444', '#f59e0b', '#84cc16', '#10b981']; // red→green, rate metric
export const COUNT_RAMP = ['#e0e7ff', '#818cf8', '#312e81']; // indigo, built-in counts
export const STORE_RAMP = ['#dbeafe', '#3b82f6', '#1e3a8a']; // blue, metric-store values (Open Navigator style)

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
