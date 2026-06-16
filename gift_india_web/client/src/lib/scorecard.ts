import type { Benchmark, ScorecardMetricValues, TrustSignal } from './api';

// ── facility scorecard ───────────────────────────────────────────────────────
/** Order signal buckets best → worst for the "group by signal" view. */
export const SIGNAL_ORDER: TrustSignal[] = ['strong', 'partial', 'weak_suspicious', 'no_claim'];

/** Letter grade from a 0–100 trust score. */
export function letterFromScore(score: number): string {
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}

/** Grade for one capability — "—" when there is no claim to assess. */
export function capabilityGrade(signal: TrustSignal, trustScore0to1: number): string {
  if (signal === 'no_claim') return '—';
  return letterFromScore(trustScore0to1 * 100);
}

// Presentation catalog for the area scorecard. Mirrors the Open Navigator
// "Selected area" scorecard, but the metrics are India's NFHS-5 health
// indicators, care-supply ratios and facility-trust signals. There is no
// year-over-year ACS series here, so the directional column compares the area
// against the chosen benchmark (nation / region / parent state) rather than a
// time trend — see scorecard help text in the page.

export type MetricFormat = 'pct' | 'per100k' | 'score';
/** up = higher is better, down = lower is better, neutral = context only (ungraded). */
export type MetricDirection = 'up' | 'down' | 'neutral';

export interface MetricMeta {
  key: string;
  label: string;
  section: string;
  format: MetricFormat;
  direction: MetricDirection;
  help?: string;
}

export interface Section {
  id: string;
  label: string;
}

export const SECTIONS: Section[] = [
  { id: 'maternal', label: 'Maternal & child health' },
  { id: 'supply', label: 'Care supply & access' },
  { id: 'trust', label: 'Facility trust & evidence' },
];

export const METRICS: MetricMeta[] = [
  // Maternal & child health (NFHS-5, population-weighted across districts)
  { key: 'institutional_birth_pct', label: 'Institutional births', section: 'maternal', format: 'pct', direction: 'up', help: 'Share of births in a health facility. Higher is safer.' },
  { key: 'anaemia_pct', label: 'Anaemia prevalence', section: 'maternal', format: 'pct', direction: 'down', help: 'Share of women who are anaemic. Lower is better.' },
  { key: 'fp_unmet_pct', label: 'Family planning unmet need', section: 'maternal', format: 'pct', direction: 'down', help: 'Share wanting to delay/avoid pregnancy but not using contraception. Lower is better.' },
  { key: 'csection_pct', label: 'C-section rate', section: 'maternal', format: 'pct', direction: 'neutral', help: 'Both very low (unmet need) and very high (over-medicalisation) are concerning, so this is shown for context and not graded.' },
  // Care supply & access
  { key: 'facilities_per_100k', label: 'Facilities per 100k', section: 'supply', format: 'per100k', direction: 'up', help: 'Tracked healthcare facilities per 100,000 people.' },
  { key: 'surgical_share', label: 'Surgical-capable facilities', section: 'supply', format: 'pct', direction: 'up', help: 'Share of facilities that offer surgery.' },
  { key: 'surgeries_per_100k', label: 'Annual surgeries per 100k', section: 'supply', format: 'per100k', direction: 'up', help: 'Reported annual surgical volume per 100,000 people.' },
  { key: 'urbanity', label: 'Urbanity', section: 'supply', format: 'pct', direction: 'neutral', help: 'How urban the area is (context for the other metrics); not graded.' },
  // Facility trust & evidence
  { key: 'avg_trust', label: 'Average capability trust', section: 'trust', format: 'score', direction: 'up', help: 'Mean evidence-backed trust score across all claimed capabilities (0–100).' },
  { key: 'strong_share', label: 'Strong-evidence share', section: 'trust', format: 'pct', direction: 'up', help: 'Share of claimed capabilities rated as strong evidence.' },
  { key: 'claim_coverage', label: 'Capability claim coverage', section: 'trust', format: 'pct', direction: 'up', help: 'Share of facility × capability checks where the capability is claimed at all.' },
];

export function metricsForSection(sectionId: string): MetricMeta[] {
  return METRICS.filter((m) => m.section === sectionId);
}

export function formatMetric(value: number | null, format: MetricFormat): string {
  if (value === null || Number.isNaN(value)) return '—';
  switch (format) {
    case 'pct':
      return `${value.toFixed(1)}%`;
    case 'per100k':
      return value >= 100 ? `${value.toFixed(0)} / 100k` : `${value.toFixed(1)} / 100k`;
    case 'score':
      return `${value.toFixed(0)} / 100`;
  }
}

// ── arrow + favorability vs the selected benchmark ───────────────────────────
export type ArrowTier = 'up2' | 'up1' | 'flat' | 'down1' | 'down2';
export type Favor = 'good' | 'bad' | 'even';

export interface Standing {
  benchmark: number | null;
  pctGap: number | null; // signed % gap of area vs benchmark
  arrow: ArrowTier;
  favor: Favor | null; // null for neutral-direction metrics
  gradable: boolean; // counts toward the section grade
}

const STRONG_GAP = 8; // |%| ≥ this → double arrow
const FLAT_GAP = 1.5; // |%| < this → flat / "even"

export function benchmarkValue(m: ScorecardMetricValues, b: Benchmark): number | null {
  return m[b];
}

export function standing(m: ScorecardMetricValues, b: Benchmark, direction: MetricDirection): Standing {
  const value = m.value;
  const benchmark = benchmarkValue(m, b);
  if (value === null || benchmark === null || benchmark === 0) {
    return { benchmark, pctGap: null, arrow: 'flat', favor: direction === 'neutral' ? null : 'even', gradable: false };
  }
  const pctGap = ((value - benchmark) / Math.abs(benchmark)) * 100;
  const mag = Math.abs(pctGap);
  let arrow: ArrowTier;
  if (mag < FLAT_GAP) arrow = 'flat';
  else if (pctGap > 0) arrow = mag >= STRONG_GAP ? 'up2' : 'up1';
  else arrow = mag >= STRONG_GAP ? 'down2' : 'down1';

  if (direction === 'neutral') {
    return { benchmark, pctGap, arrow, favor: null, gradable: false };
  }
  let favor: Favor;
  if (mag < FLAT_GAP) favor = 'even';
  else favor = (direction === 'up') === pctGap > 0 ? 'good' : 'bad';
  return { benchmark, pctGap, arrow, favor, gradable: true };
}

export interface SectionGrade {
  favorable: number;
  total: number;
  letter: string;
}

export function sectionGrade(standings: Standing[]): SectionGrade {
  const graded = standings.filter((s) => s.gradable);
  const favorable = graded.filter((s) => s.favor === 'good').length;
  const total = graded.length;
  const ratio = total > 0 ? favorable / total : 0;
  let letter = 'F';
  if (total === 0) letter = '—';
  else if (ratio >= 0.8) letter = 'A';
  else if (ratio >= 0.5) letter = 'B';
  else if (ratio >= 0.25) letter = 'C';
  else if (ratio >= 0.1) letter = 'D';
  return { favorable, total, letter };
}

export const ARROW_GLYPH: Record<ArrowTier, string> = {
  up2: '↑↑',
  up1: '↑',
  flat: '→',
  down1: '↓',
  down2: '↓↓',
};

export function benchmarkLabel(b: Benchmark, regionName?: string | null): string {
  if (b === 'nation') return 'India avg';
  if (b === 'region') return regionName ? `${regionName} avg` : 'Region avg';
  return 'State avg';
}

export const GRADE_TONE: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  B: 'bg-lime-100 text-lime-800 border-lime-200',
  C: 'bg-amber-100 text-amber-800 border-amber-200',
  D: 'bg-orange-100 text-orange-800 border-orange-200',
  F: 'bg-red-100 text-red-800 border-red-200',
  '—': 'bg-muted text-muted-foreground border-border',
};
