// ── India coverage facts ──────────────────────────────────────────────────────
// The hero used to surface `COUNT(DISTINCT state)` straight from gold.facilities
// as "States covered". That column is dirty (district / city names leak into it),
// so it reported far more "states" than India actually has — a made-up number.
// These constants and helpers keep the landing page honest and are unit-tested.

/** India's administrative composition (as of 2026). */
export const INDIA_STATES = 28;
export const INDIA_UNION_TERRITORIES = 8;
/** Total top-level administrative regions: 28 states + 8 union territories. */
export const INDIA_ADMIN_REGIONS = INDIA_STATES + INDIA_UNION_TERRITORIES; // 36

export interface AnalyzedDistrict {
  /** District (or city) we have hand-curated, in-depth trust analysis for. */
  district: string;
  /** Parent state / union territory. */
  state: string;
  /** One-line character sketch shown on the landing page. */
  blurb: string;
}

/**
 * Districts with detailed, hand-curated trust analysis. Thousands of facilities
 * are loaded into gold.facilities, but only these are deeply profiled today —
 * everything else is "more coming soon".
 */
export const ANALYZED_DISTRICTS: AnalyzedDistrict[] = [
  { district: 'Mumbai City / Suburban', state: 'Maharashtra', blurb: 'dense coastal urban, high income' },
  { district: 'New Delhi / Central Delhi', state: 'Delhi NCT', blurb: 'political hub, high income, inland' },
  { district: 'Bengaluru Urban', state: 'Karnataka', blurb: 'tech-driven, South India, high growth' },
  { district: 'Lucknow', state: 'Uttar Pradesh', blurb: 'large northern-plains district, medium-low income' },
  { district: 'Jaisalmer', state: 'Rajasthan', blurb: 'vast desert/rural district, low density, arid' },
];

/** Number of districts with detailed analysis. */
export const ANALYZED_DISTRICT_COUNT = ANALYZED_DISTRICTS.length;

/**
 * Deep-link to the navigator map, pre-drilled to an analyzed district. The state
 * / district here are descriptive labels ("Delhi NCT", "Mumbai City / Suburban");
 * the map resolves them to the data's canonical names (loose, token-overlap match)
 * before selecting, so the link works despite the label ≠ data-name mismatch.
 */
export function navigatorLinkFor(d: Pick<AnalyzedDistrict, 'state' | 'district'>): string {
  const params = new URLSearchParams({ state: d.state, district: d.district });
  return `/navigator?${params.toString()}`;
}

/** Number of distinct states / UTs those analyzed districts span. */
export const ANALYZED_STATE_COUNT = new Set(ANALYZED_DISTRICTS.map((d) => d.state)).size;

/**
 * Honest "states covered" figure. The raw distinct-state count from the data can
 * be dirty (and can exceed what India even has), so never claim to cover more
 * regions than exist, and never report a negative / non-finite count.
 */
export function clampStatesCovered(distinctStatesInData: number): number {
  if (!Number.isFinite(distinctStatesInData) || distinctStatesInData < 0) return 0;
  return Math.min(Math.trunc(distinctStatesInData), INDIA_ADMIN_REGIONS);
}
