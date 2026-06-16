import { z } from 'zod';
import { Application, Request } from 'express';
import { CAPABILITIES, type CapabilityGuide, type TrustSignal } from './capabilities';
import { regionOf, statesInRegion, REGION_VALUES, type Region } from './regions';
import { mapStateCtes } from './stateCanonical';
import { setupIngestRoutes } from './ingest';

interface LakebaseQuery {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

interface AppKitWithLakebase {
  lakebase: LakebaseQuery;
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const SIGNALS: TrustSignal[] = ['strong', 'partial', 'weak_suspicious', 'no_claim'];
const CAP_KEYS = CAPABILITIES.map((c) => c.key);

function tierToSignal(tier: string | null | undefined): TrustSignal {
  switch (tier) {
    case 'Strong':
      return 'strong';
    case 'Moderate':
      return 'partial';
    case 'Weak':
      return 'weak_suspicious';
    case 'Insufficient':
    case null:
    case undefined:
    default:
      return 'no_claim';
  }
}

// Synthetic "All" capability: aggregates every capability into one per-facility
// view. Selectable in the navigator alongside the real capabilities, but never a
// valid override target (overrides are always per real capability).
const ALL_CAPABILITY = 'all';
const CAP_KEYS_WITH_ALL = [ALL_CAPABILITY, ...CAP_KEYS];

// Collapse a facility's per-capability assessments into one row: claimed if it
// claims any capability, score = mean evidence_strength_score (fallback trust_score),
// signal binned from that mean, evidence tallied across capabilities.
const FACILITY_CAP_ROLLUP = `
  SELECT a.facility_id,
         bool_or(a.claimed)                                            AS claimed,
         AVG(COALESCE(s.evidence_strength_score, a.trust_score))
             FILTER (WHERE a.claimed)                                  AS trust_score,
         COALESCE(SUM(a.evidence_count), 0)::int                         AS evidence_count,
         COALESCE(SUM(a.supporting_count), 0)::int                     AS supporting_count,
         COALESCE(SUM(a.contradicting_count), 0)::int                  AS contradicting_count,
         (array_agg(a.best_source ORDER BY COALESCE(s.evidence_strength_score, a.trust_score) DESC NULLS LAST))[1] AS best_source,
         (array_agg(a.summary ORDER BY COALESCE(s.evidence_strength_score, a.trust_score) DESC NULLS LAST))[1]     AS summary,
         CASE
           WHEN NOT bool_or(a.claimed) THEN 'no_claim'
           WHEN AVG(COALESCE(s.evidence_strength_score, a.trust_score)) FILTER (WHERE a.claimed) >= 0.85 THEN 'strong'
           WHEN AVG(COALESCE(s.evidence_strength_score, a.trust_score)) FILTER (WHERE a.claimed) >= 0.65 THEN 'partial'
           WHEN AVG(COALESCE(s.evidence_strength_score, a.trust_score)) FILTER (WHERE a.claimed) >= 0.45 THEN 'weak_suspicious'
           ELSE 'weak_suspicious'
         END                                                           AS trust_signal
  FROM gold.facility_capability_assessments a
  LEFT JOIN gold.capability_scored s
    ON s.facility_id = a.facility_id AND s.capability = a.capability
  GROUP BY a.facility_id`;

// Planner overrides only — all facility/capability/evidence data is served from
// gold.* (built by gift_india_dbt: `make dbt`). Never seed synthetic rows here.
const SETUP_SQL = `
  CREATE SCHEMA IF NOT EXISTS app;
  CREATE TABLE IF NOT EXISTS app.capability_overrides (
    id              SERIAL PRIMARY KEY,
    created_by      TEXT,
    facility_id     TEXT NOT NULL,
    capability      TEXT NOT NULL,
    facility_name   TEXT,
    original_signal TEXT,
    override_signal TEXT NOT NULL,
    original_score  DOUBLE PRECISION,
    override_score  DOUBLE PRECISION,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE app.capability_overrides ADD COLUMN IF NOT EXISTS original_score DOUBLE PRECISION;
  ALTER TABLE app.capability_overrides ADD COLUMN IF NOT EXISTS override_score DOUBLE PRECISION;

  CREATE TABLE IF NOT EXISTS app.merge_reviews (
    id              SERIAL PRIMARY KEY,
    candidate_id    TEXT NOT NULL,
    decision        TEXT NOT NULL,
    reviewed_by     TEXT,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS merge_reviews_candidate_idx ON app.merge_reviews (candidate_id);

  CREATE TABLE IF NOT EXISTS app.website_url_updates (
    id              SERIAL PRIMARY KEY,
    facility_id     TEXT NOT NULL,
    facility_name   TEXT,
    old_url         TEXT,
    new_url         TEXT NOT NULL,
    reviewed_by     TEXT,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS website_url_updates_facility_idx ON app.website_url_updates (facility_id);

  CREATE TABLE IF NOT EXISTS app.data_quality_flags (
    id              SERIAL PRIMARY KEY,
    facility_id     TEXT NOT NULL,
    flag_type       TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'medium',
    detail          TEXT,
    related_id      TEXT,
    status          TEXT NOT NULL DEFAULT 'open',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    resolved_by     TEXT
  );
  CREATE INDEX IF NOT EXISTS data_quality_flags_facility_idx ON app.data_quality_flags (facility_id);
  CREATE INDEX IF NOT EXISTS data_quality_flags_status_idx ON app.data_quality_flags (status, flag_type);
`;

async function assertGoldServingTables(lakebase: LakebaseQuery): Promise<void> {
  const { rows } = await lakebase.query(`
    SELECT
      to_regclass('gold.facilities') IS NOT NULL AS has_facilities,
      to_regclass('gold.facility_capability_assessments') IS NOT NULL AS has_assessments,
      to_regclass('gold.capability_evidence') IS NOT NULL AS has_evidence
  `);
  const r = rows[0] ?? {};
  if (!r.has_facilities) {
    throw new Error('gold.facilities is missing — run `make data` (or publish + dbt against Lakebase).');
  }
  if (!r.has_assessments || !r.has_evidence) {
    throw new Error(
      'gold.facility_capability_assessments / gold.capability_evidence are missing — run `make dbt` against this database.',
    );
  }
  const { rows: counts } = await lakebase.query(`
    SELECT
      (SELECT COUNT(*) FROM gold.facilities) AS facilities,
      (SELECT COUNT(*) FROM gold.facility_capability_assessments) AS assessments
  `);
  console.log(
    '[trust-desk] serving from gold.* (%s facilities, %s capability assessments)',
    counts[0]?.facilities,
    counts[0]?.assessments,
  );
}

function currentUser(req: Request): string {
  return req.header('x-forwarded-email') || req.header('x-forwarded-user') || 'local-dev@gift_india';
}

function txt(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : `${v as string | number | boolean}`;
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function isMissingRelation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /does not exist|relation .* not found/i.test(msg);
}

// ── scorecard: per-area metrics rolled up from the district grain ─────────────
// One combined row per district carrying the NFHS-5 health rates, care-supply
// counts and capability-trust aggregates. Scopes (nation / region / state /
// the selected area) are subsets of these rows; metric values are recomputed
// from the subset so every benchmark is consistent with the area value.
interface DistrictRow {
  state: string;
  district: string;
  region: Region | null;
  population: number;
  // NFHS-5 rates (nullable in the synthetic dataset)
  institutional_birth_pct: number | null;
  csection_pct: number | null;
  anaemia_pct: number | null;
  fp_unmet_pct: number | null;
  urbanity: number | null;
  // care supply
  facility_count: number;
  surgical_facility_count: number;
  annual_surgeries_total: number;
  // capability trust (across all capabilities)
  assessments: number;
  claiming: number;
  strong: number;
  avg_trust: number | null; // 0–1, mean over claimed assessments in the district
}

export const SCORECARD_METRIC_KEYS = [
  'institutional_birth_pct',
  'csection_pct',
  'anaemia_pct',
  'fp_unmet_pct',
  'facilities_per_100k',
  'surgical_share',
  'surgeries_per_100k',
  'urbanity',
  'avg_trust',
  'strong_share',
  'claim_coverage',
] as const;
type MetricKey = (typeof SCORECARD_METRIC_KEYS)[number];

/** Population-weighted mean of a nullable rate column over a set of districts. */
function wAvg(rows: DistrictRow[], key: keyof DistrictRow): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const v = r[key] as number | null;
    if (v !== null && v !== undefined) {
      num += v * r.population;
      den += r.population;
    }
  }
  return den > 0 ? num / den : null;
}

function aggregate(rows: DistrictRow[]): Record<MetricKey, number | null> {
  let population = 0;
  let facilities = 0;
  let surgical = 0;
  let surgeries = 0;
  let claiming = 0;
  let strong = 0;
  let assessments = 0;
  let trustW = 0;
  for (const r of rows) {
    population += r.population;
    facilities += r.facility_count;
    surgical += r.surgical_facility_count;
    surgeries += r.annual_surgeries_total;
    claiming += r.claiming;
    strong += r.strong;
    assessments += r.assessments;
    if (r.avg_trust !== null) trustW += r.avg_trust * r.claiming;
  }
  const urb = wAvg(rows, 'urbanity');
  return {
    institutional_birth_pct: wAvg(rows, 'institutional_birth_pct'),
    csection_pct: wAvg(rows, 'csection_pct'),
    anaemia_pct: wAvg(rows, 'anaemia_pct'),
    fp_unmet_pct: wAvg(rows, 'fp_unmet_pct'),
    urbanity: urb === null ? null : urb * 100,
    facilities_per_100k: population > 0 ? (facilities / population) * 100_000 : null,
    surgical_share: facilities > 0 ? (surgical / facilities) * 100 : null,
    surgeries_per_100k: population > 0 ? (surgeries / population) * 100_000 : null,
    avg_trust: claiming > 0 ? (trustW / claiming) * 100 : null,
    strong_share: claiming > 0 ? (strong / claiming) * 100 : null,
    claim_coverage: assessments > 0 ? (claiming / assessments) * 100 : null,
  };
}

function popSum(rows: DistrictRow[]): number {
  return rows.reduce((a, r) => a + r.population, 0);
}
function facSum(rows: DistrictRow[]): number {
  return rows.reduce((a, r) => a + r.facility_count, 0);
}

const ScorecardQuery = z.object({
  level: z.enum(['nation', 'state', 'district']).default('nation'),
  state: z.string().optional(),
  district: z.string().optional(),
});

// ── metric store (NFHS) — resolve the synced table names once at runtime ─────
// The metric catalog/values land in Lakebase from the Databricks gold layer; the
// exact synced schema can vary, so probe a handful of qualified names rather than
// hard-coding one. Falls back to catalog-only (built-in metrics) if absent.
interface CatalogMetric {
  key: string;
  name?: string;
  label: string;
  category: string;
  unit: string;
  source: 'builtin' | 'store';
}
interface CatalogGroup {
  category: string;
  builtin: boolean;
  metrics: CatalogMetric[];
}

const BUILTIN_GROUP: CatalogGroup = {
  category: 'Trust & Capacity',
  builtin: true,
  metrics: [
    { key: 'rating', label: 'Region trust rating', category: 'Trust & Capacity', unit: 'score', source: 'builtin' },
    { key: 'facilities', label: 'Facility count', category: 'Trust & Capacity', unit: 'count', source: 'builtin' },
    { key: 'strong', label: 'Strong-evidence signals', category: 'Trust & Capacity', unit: 'count', source: 'builtin' },
    { key: 'claiming', label: 'Facilities claiming capability', category: 'Trust & Capacity', unit: 'count', source: 'builtin' },
  ],
};

let METRIC_TABLES: { catalog: string; values: string } | null | undefined;

async function resolveMetricTables(lakebase: LakebaseQuery): Promise<{ catalog: string; values: string } | null> {
  if (METRIC_TABLES !== undefined) return METRIC_TABLES;
  const pick = async (names: string[]): Promise<string | null> => {
    for (const n of names) {
      try {
        const { rows } = await lakebase.query('SELECT to_regclass($1) IS NOT NULL AS ok', [n]);
        if (rows[0]?.ok) return n;
      } catch {
        /* keep probing */
      }
    }
    return null;
  };
  const catalog = await pick(['gold_gift_india.gold_metric', 'gold.gold_metric', 'gold_metric', 'public.gold_metric', 'gold.metric']);
  const values = await pick([
    'gold_gift_india.gold_metric_values',
    'gold.gold_metric_values',
    'gold_metric_values',
    'public.gold_metric_values',
    'gold.metric_values',
  ]);
  METRIC_TABLES = catalog && values ? { catalog, values } : null;
  if (METRIC_TABLES) console.log('[trust-desk] metric store: %s / %s', catalog, values);
  return METRIC_TABLES;
}

const FacilitiesQuery = z.object({
  capability: z.enum(CAP_KEYS_WITH_ALL as [string, ...string[]]),
  region: z.enum(REGION_VALUES as [Region, ...Region[]]).optional(),
  state: z.string().optional(),
  district: z.string().optional(),
  signal: z.enum(SIGNALS as [string, ...string[]]).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const OverrideBody = z.object({
  facilityId: z.string().min(1),
  capability: z.enum(CAP_KEYS as [string, ...string[]]),
  overrideSignal: z.enum(SIGNALS as [string, ...string[]]),
  overrideScore: z.number().min(0).max(1),
  note: z.string().max(2000).optional(),
});

function scoresEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

export async function setupgift_indiaRoutes(appkit: AppKitWithLakebase) {
  try {
    await appkit.lakebase.query(SETUP_SQL);
    await assertGoldServingTables(appkit.lakebase);
  } catch (err) {
    console.warn('[trust-desk] gold serving check failed:', (err as Error).message);
  }

  await setupIngestRoutes(appkit);

  appkit.server.extend((app) => {
    app.get('/api/whoami', (req, res) => {
      res.json({ email: currentUser(req) });
    });

    app.get('/api/stats', async (_req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(`
          SELECT
            (SELECT COUNT(*) FROM gold.facilities) AS facilities,
            (SELECT COUNT(DISTINCT state) FROM gold.facilities) AS states,
            (SELECT COUNT(*) FROM gold.facility_capability_assessments WHERE trust_signal <> 'no_claim') AS assessed_claims,
            (SELECT COUNT(*) FROM gold.facility_capability_assessments WHERE trust_signal = 'strong') AS strong,
            (SELECT COUNT(*) FROM gold.facility_capability_assessments WHERE trust_signal = 'weak_suspicious') AS suspicious,
            (SELECT COUNT(*) FROM gold.capability_evidence) AS citations
        `);
        res.json(rows[0] ?? {});
      } catch (err) {
        console.error('stats failed:', err);
        res.status(500).json({ error: 'Failed to load stats' });
      }
    });

    app.get('/api/capabilities', async (_req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(`
          SELECT capability,
            COUNT(*) FILTER (WHERE claimed)                          AS claiming,
            COUNT(*) FILTER (WHERE trust_signal = 'strong')          AS strong,
            COUNT(*) FILTER (WHERE trust_signal = 'partial')         AS partial,
            COUNT(*) FILTER (WHERE trust_signal = 'weak_suspicious') AS weak,
            COUNT(*) FILTER (WHERE trust_signal = 'no_claim')        AS no_claim
          FROM gold.facility_capability_assessments
          GROUP BY capability
        `);
        const byKey = new Map(rows.map((r) => [txt(r.capability), r]));
        const out: {
          key: string;
          label: string;
          description: string;
          guide: CapabilityGuide;
          claiming: number;
          strong: number;
          partial: number;
          weak: number;
          noClaim: number;
        }[] = CAPABILITIES.map((c) => {
          const r = byKey.get(c.key) ?? {};
          return {
            key: c.key,
            label: c.label,
            description: c.description,
            guide: c.guide,
            claiming: Number(r.claiming ?? 0),
            strong: Number(r.strong ?? 0),
            partial: Number(r.partial ?? 0),
            weak: Number(r.weak ?? 0),
            noClaim: Number(r.no_claim ?? 0),
          };
        });
        // "All" pill: per-facility rollup counts (each facility counted once,
        // classified by its mean trust) so the badge matches the map's All view.
        const { rows: allRows } = await appkit.lakebase.query(`
          WITH r AS (${FACILITY_CAP_ROLLUP})
          SELECT
            COUNT(*) FILTER (WHERE claimed)                          AS claiming,
            COUNT(*) FILTER (WHERE trust_signal = 'strong')          AS strong,
            COUNT(*) FILTER (WHERE trust_signal = 'partial')         AS partial,
            COUNT(*) FILTER (WHERE trust_signal = 'weak_suspicious') AS weak,
            COUNT(*) FILTER (WHERE trust_signal = 'no_claim')        AS no_claim
          FROM r
        `);
        const a = allRows[0] ?? {};
        out.unshift({
          key: ALL_CAPABILITY,
          label: 'All',
          description: 'Overall trust across every capability, one rating per facility.',
          guide: {
            headline:
              'A rolled-up trust view across ICU, maternity, emergency, oncology, trauma, and NICU — one composite signal per facility.',
            whatCounts: [
              'Mean trust score across all six capability assessments for each facility',
              'Useful for comparing overall evidence quality before drilling into a specific service line',
            ],
            howWeGrade:
              'Each facility is classified by its average trust across capabilities. Switch to a specific capability for claim-level detail, evidence tiers, and citations.',
          },
          claiming: Number(a.claiming ?? 0),
          strong: Number(a.strong ?? 0),
          partial: Number(a.partial ?? 0),
          weak: Number(a.weak ?? 0),
          noClaim: Number(a.no_claim ?? 0),
        });
        res.json(out);
      } catch (err) {
        console.error('capabilities failed:', err);
        res.status(500).json({ error: 'Failed to load capabilities' });
      }
    });

    app.get('/api/regions', async (_req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(`
          SELECT state, MAX(state_code) AS state_code, district, COUNT(*)::int AS facilities
          FROM gold.facilities
          GROUP BY state, district
          ORDER BY state, district
        `);
        const states = new Map<
          string,
          { state: string; stateCode: string; facilities: number; districts: { district: string; facilities: number }[] }
        >();
        for (const r of rows) {
          const st = txt(r.state);
          if (!states.has(st)) states.set(st, { state: st, stateCode: txt(r.state_code), facilities: 0, districts: [] });
          const entry = states.get(st)!;
          entry.facilities += Number(r.facilities);
          entry.districts.push({ district: txt(r.district), facilities: Number(r.facilities) });
        }
        res.json(Array.from(states.values()));
      } catch (err) {
        console.error('regions failed:', err);
        res.status(500).json({ error: 'Failed to load regions' });
      }
    });

    // Region rating roll-ups for the drilldown map: one rating per state and per
    // district, scoped to a capability. Region ratings are an aggregate of their
    // facilities' trust — the underlying ranking is always per-facility.
    app.get('/api/map/geography', async (req, res) => {
      const capability = txt(req.query.capability) || 'icu';
      const regionParam = txt(req.query.region).trim();
      const region = regionParam ? (regionParam as Region) : null;
      const stateParam = txt(req.query.state).trim() || null;
      const includeDistricts = txt(req.query.includeDistricts).trim() !== 'false';
      if (!CAP_KEYS_WITH_ALL.includes(capability)) {
        res.status(400).json({ error: 'Invalid capability' });
        return;
      }
      if (region && !REGION_VALUES.includes(region)) {
        res.status(400).json({ error: 'Invalid region' });
        return;
      }
      try {
        const agg = `
            COUNT(*)::int                                                  AS facilities,
            COUNT(*) FILTER (WHERE a.claimed)::int                         AS claiming,
            AVG(a.trust_score) FILTER (WHERE a.claimed)                    AS avg_score,
            COUNT(*) FILTER (WHERE a.trust_signal = 'strong')::int         AS strong,
            COUNT(*) FILTER (WHERE a.trust_signal = 'partial')::int        AS partial,
            COUNT(*) FILTER (WHERE a.trust_signal = 'weak_suspicious')::int AS weak,
            COUNT(*) FILTER (WHERE a.trust_signal = 'no_claim')::int       AS no_claim`;
        const regionStates = region ? statesInRegion(region) : null;
        // "All" joins one rolled-up row per facility (so a facility is counted
        // once, not six times); a single capability joins that capability's row.
        const isAll = capability === ALL_CAPABILITY;
        const assess = isAll
          ? `JOIN (${FACILITY_CAP_ROLLUP}) a ON a.facility_id = f.facility_id`
          : `JOIN gold.facility_capability_assessments a
               ON a.facility_id = f.facility_id AND a.capability = $1`;
        const regionFilter = isAll ? '$1' : '$2';
        const params: unknown[] = isAll ? [regionStates] : [capability, regionStates];
        const mapCtes = mapStateCtes();
        const statesPromise = appkit.lakebase.query(
          `WITH ${mapCtes}
           SELECT f.map_state AS state, MAX(f.map_state_code) AS state_code, ${agg}
             FROM facility_map_state f
             ${assess}
             WHERE (${regionFilter}::text[] IS NULL OR f.map_state = ANY(${regionFilter}))
             GROUP BY f.map_state`,
          params,
        );
        const districtsPromise = includeDistricts
          ? appkit.lakebase.query(
              `WITH ${mapCtes}
               SELECT f.map_state AS state, f.district, MAX(f.map_state_code) AS state_code,
                    MAX(g.lat) AS lat, MAX(g.lon) AS lon, MAX(g.population)::bigint AS population, ${agg}
             FROM facility_map_state f
             ${assess}
             LEFT JOIN gold.geography g ON g.district = f.district AND g.state = f.map_state
             WHERE (${regionFilter}::text[] IS NULL OR f.map_state = ANY(${regionFilter}))
               AND ($${params.length + 1}::text IS NULL OR f.map_state = $${params.length + 1})
             GROUP BY f.map_state, f.district`,
              [...params, stateParam],
            )
          : Promise.resolve({ rows: [] as Record<string, unknown>[] });
        const [{ rows: states }, { rows: districts }] = await Promise.all([statesPromise, districtsPromise]);
        const toRating = (r: Record<string, unknown>) => ({
          facilities: Number(r.facilities ?? 0),
          claiming: Number(r.claiming ?? 0),
          avgScore: r.avg_score === null || r.avg_score === undefined ? null : Number(r.avg_score),
          strong: Number(r.strong ?? 0),
          partial: Number(r.partial ?? 0),
          weak: Number(r.weak ?? 0),
          noClaim: Number(r.no_claim ?? 0),
        });
        res.json({
          capability,
          region,
          states: states.map((r) => ({ state: txt(r.state), stateCode: txt(r.state_code), ...toRating(r) })),
          districts: districts.map((r) => ({
            state: txt(r.state),
            district: txt(r.district),
            stateCode: txt(r.state_code),
            lat: r.lat === null ? null : Number(r.lat),
            lon: r.lon === null ? null : Number(r.lon),
            population: r.population === null ? null : Number(r.population),
            ...toRating(r),
          })),
        });
      } catch (err) {
        console.error('map geography failed:', err);
        res.status(500).json({ error: 'Failed to load map geography' });
      }
    });

    // Metric catalog for the navigator's left panel — built-in Trust & Capacity
    // metrics plus the NFHS metric store, grouped by category.
    app.get('/api/metrics/catalog', async (_req, res) => {
      try {
        const t = await resolveMetricTables(appkit.lakebase);
        const groups: CatalogGroup[] = [BUILTIN_GROUP];
        if (t) {
          const { rows } = await appkit.lakebase.query(
            `SELECT metric_key, metric_name, metric_label, metric_category, metric_unit
             FROM ${t.catalog}
             WHERE COALESCE(n_numeric_values, 1) > 0
             ORDER BY metric_category, metric_label`,
          );
          const byCat = new Map<string, CatalogMetric[]>();
          for (const r of rows) {
            const category = txt(r.metric_category) || 'Uncategorized';
            if (!byCat.has(category)) byCat.set(category, []);
            byCat.get(category)!.push({
              key: txt(r.metric_key),
              name: txt(r.metric_name),
              label: txt(r.metric_label),
              category,
              unit: txt(r.metric_unit),
              source: 'store',
            });
          }
          for (const [category, metrics] of byCat) groups.push({ category, builtin: false, metrics });
        }
        res.json({ groups, storeAvailable: !!t });
      } catch (err) {
        console.error('metrics catalog failed:', err);
        res.json({ groups: [BUILTIN_GROUP], storeAvailable: false });
      }
    });

    // District-grain values for one store metric; state/national roll-ups are
    // computed client-side from these so the same payload drives every level.
    app.get('/api/metrics/values', async (req, res) => {
      const key = txt(req.query.key);
      if (!key) {
        res.status(400).json({ error: 'key required' });
        return;
      }
      try {
        const t = await resolveMetricTables(appkit.lakebase);
        if (!t) {
          res.status(404).json({ error: 'metric store unavailable' });
          return;
        }
        const { rows } = await appkit.lakebase.query(
          `SELECT state, entity_id AS district, metric_value AS value
           FROM ${t.values}
           WHERE metric_key = $1 AND entity_type = 'district' AND metric_value IS NOT NULL`,
          [key],
        );
        res.json({
          key,
          districts: rows.map((r) => ({ state: txt(r.state), district: txt(r.district), value: Number(r.value) })),
        });
      } catch (err) {
        console.error('metric values failed:', err);
        res.status(500).json({ error: 'Failed to load metric values' });
      }
    });

    // Open-Navigator-style area scorecard: NFHS-5 health, care-supply and
    // capability-trust metrics for a selected area (whole nation / state /
    // district), each compared against the nation, the area's zonal region and
    // its parent state. Letter grades are derived client-side from favorable
    // standings vs the chosen benchmark.
    app.get('/api/scorecard', async (req, res) => {
      const parsed = ScorecardQuery.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
        return;
      }
      const { level, state, district } = parsed.data;
      if ((level === 'state' || level === 'district') && !state) {
        res.status(400).json({ error: 'state is required for state/district level' });
        return;
      }
      if (level === 'district' && !district) {
        res.status(400).json({ error: 'district is required for district level' });
        return;
      }
      try {
        const [{ rows: geo }, { rows: trust }] = await Promise.all([
          appkit.lakebase.query(`
            SELECT district, state, population, urbanity,
                   fp_unmet_pct, institutional_birth_pct, csection_pct, anaemia_pct,
                   facility_count, surgical_facility_count, annual_surgeries_total
            FROM gold.geography
          `),
          appkit.lakebase.query(`
            SELECT f.state, f.district,
                   COUNT(*)::int                                          AS assessments,
                   COUNT(*) FILTER (WHERE a.claimed)::int                 AS claiming,
                   COUNT(*) FILTER (WHERE a.trust_signal = 'strong')::int AS strong,
                   AVG(a.trust_score) FILTER (WHERE a.claimed)            AS avg_trust
            FROM gold.facilities f
            JOIN gold.facility_capability_assessments a USING (facility_id)
            GROUP BY f.state, f.district
          `),
        ]);

        const key = (s: string, d: string) => `${s.toLowerCase().trim()}|${d.toLowerCase().trim()}`;
        const trustByKey = new Map(trust.map((r) => [key(txt(r.state), txt(r.district)), r]));
        const rows: DistrictRow[] = geo.map((g) => {
          const st = txt(g.state);
          const dt = txt(g.district);
          const t = trustByKey.get(key(st, dt));
          return {
            state: st,
            district: dt,
            region: regionOf(st),
            population: Number(g.population ?? 0),
            institutional_birth_pct: num(g.institutional_birth_pct),
            csection_pct: num(g.csection_pct),
            anaemia_pct: num(g.anaemia_pct),
            fp_unmet_pct: num(g.fp_unmet_pct),
            urbanity: num(g.urbanity),
            facility_count: Number(g.facility_count ?? 0),
            surgical_facility_count: Number(g.surgical_facility_count ?? 0),
            annual_surgeries_total: Number(g.annual_surgeries_total ?? 0),
            assessments: t ? Number(t.assessments ?? 0) : 0,
            claiming: t ? Number(t.claiming ?? 0) : 0,
            strong: t ? Number(t.strong ?? 0) : 0,
            avg_trust: t ? num(t.avg_trust) : null,
          };
        });

        const sameState = (r: DistrictRow) => state && r.state.toLowerCase() === state.toLowerCase();
        const areaRows =
          level === 'nation'
            ? rows
            : level === 'state'
              ? rows.filter(sameState)
              : rows.filter((r) => sameState(r) && r.district.toLowerCase() === district!.toLowerCase());

        if (areaRows.length === 0) {
          res.status(404).json({ error: 'No data for the selected area' });
          return;
        }

        const areaRegion = level === 'nation' ? null : (areaRows[0]?.region ?? null);
        const regionRows = areaRegion ? rows.filter((r) => r.region === areaRegion) : [];
        const stateRows = state ? rows.filter(sameState) : [];

        const aArea = aggregate(areaRows);
        const aNation = aggregate(rows);
        const aRegion = areaRegion ? aggregate(regionRows) : null;
        const aState = level === 'district' ? aggregate(stateRows) : null;

        const metrics: Record<string, { value: number | null; nation: number | null; region: number | null; state: number | null }> = {};
        for (const k of SCORECARD_METRIC_KEYS) {
          metrics[k] = {
            value: aArea[k],
            nation: aNation[k],
            region: aRegion ? aRegion[k] : null,
            state: aState ? aState[k] : null,
          };
        }

        res.json({
          area: {
            level,
            name: level === 'nation' ? 'India' : level === 'state' ? state : district,
            state: state ?? null,
            district: level === 'district' ? district : null,
            region: areaRegion,
            population: popSum(areaRows),
            facilities: facSum(areaRows),
            districtCount: areaRows.length,
          },
          benchmarks: {
            nation: true,
            region: areaRegion !== null && level !== 'nation',
            state: level === 'district',
          },
          metrics,
        });
      } catch (err) {
        console.error('scorecard failed:', err);
        res.status(500).json({ error: 'Failed to load scorecard' });
      }
    });

    app.get('/api/facilities', async (req, res) => {
      const parsed = FacilitiesQuery.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
        return;
      }
      const { capability, state, district, signal, q, limit } = parsed.data;
      const regionStates = parsed.data.region ? statesInRegion(parsed.data.region) : null;
      try {
        // "All" ranks one rolled-up row per facility (mean trust across every
        // capability, no per-capability override). A single capability ranks that
        // capability's assessment and layers the planner override on top.
        const isAll = capability === ALL_CAPABILITY;
        const { rows } = isAll
          ? await appkit.lakebase.query(
              `SELECT f.facility_id, f.name, f.type, f.district, f.state, f.state_code, f.beds,
                      f.lat, f.lon, f.website_url, f.match_confidence,
                      a.claimed, a.trust_signal, a.trust_score, a.evidence_count,
                      a.supporting_count, a.contradicting_count, a.best_source, a.summary,
                      NULL::text AS override_signal, NULL::text AS override_note
               FROM (${FACILITY_CAP_ROLLUP}) a
               JOIN gold.facilities f USING (facility_id)
               WHERE ($1::text IS NULL OR f.state = $1)
                 AND ($2::text[] IS NULL OR f.state = ANY($2))
                 AND ($3::text IS NULL OR f.district = $3)
                 AND (
                   a.trust_signal = $4
                   OR ($4::text IS NULL AND (a.trust_signal <> 'no_claim' OR $3::text IS NOT NULL))
                 )
                 AND ($5::text IS NULL OR f.name ILIKE '%' || $5 || '%')
               ORDER BY a.trust_score DESC NULLS LAST, a.evidence_count DESC, f.name
               LIMIT $6::int`,
              [state ?? null, regionStates, district ?? null, signal ?? null, q ?? null, limit],
            )
          : await appkit.lakebase.query(
              `SELECT f.facility_id, f.name, f.type, f.district, f.state, f.state_code, f.beds,
                      f.lat, f.lon, f.website_url, f.match_confidence,
                      a.claimed,
                      COALESCE(
                        CASE s.evidence_tier
                          WHEN 'Strong' THEN 'strong'
                          WHEN 'Moderate' THEN 'partial'
                          WHEN 'Weak' THEN 'weak_suspicious'
                          WHEN 'Insufficient' THEN 'no_claim'
                        END,
                        a.trust_signal
                      ) AS trust_signal,
                      COALESCE(s.evidence_strength_score, a.trust_score) AS trust_score,
                      s.evidence_tier,
                      a.evidence_count,
                      a.supporting_count, a.contradicting_count, a.best_source, a.summary,
                      ov.override_signal, ov.override_score, ov.note AS override_note,
                      (ej.assessment_json->>'review_recommended')::boolean AS review_recommended,
                      ej.assessment_json->>'review_reason' AS review_reason
               FROM gold.facility_capability_assessments a
               JOIN gold.facilities f USING (facility_id)
               LEFT JOIN gold.capability_scored s
                 ON s.facility_id = a.facility_id AND s.capability = a.capability
               LEFT JOIN gold.capability_evidence_json ej
                 ON ej.facility_id = f.facility_id AND ej.capability = a.capability
               LEFT JOIN LATERAL (
                 SELECT override_signal, override_score, note FROM app.capability_overrides o
                 WHERE o.facility_id = f.facility_id AND o.capability = a.capability AND o.created_by = $8
                 ORDER BY o.created_at DESC LIMIT 1
               ) ov ON TRUE
               WHERE a.capability = $1
                 AND ($2::text IS NULL OR f.state = $2)
                 AND ($3::text[] IS NULL OR f.state = ANY($3))
                 AND ($4::text IS NULL OR f.district = $4)
                 AND (
                   COALESCE(
                     CASE s.evidence_tier
                       WHEN 'Strong' THEN 'strong'
                       WHEN 'Moderate' THEN 'partial'
                       WHEN 'Weak' THEN 'weak_suspicious'
                       WHEN 'Insufficient' THEN 'no_claim'
                     END,
                     a.trust_signal
                   ) = $5
                   OR (
                     $5::text IS NULL
                     AND (
                       $4::text IS NOT NULL
                       OR COALESCE(
                         CASE s.evidence_tier
                           WHEN 'Strong' THEN 'strong'
                           WHEN 'Moderate' THEN 'partial'
                           WHEN 'Weak' THEN 'weak_suspicious'
                           WHEN 'Insufficient' THEN 'no_claim'
                         END,
                         a.trust_signal
                       ) <> 'no_claim'
                     )
                   )
                 )
                 AND ($6::text IS NULL OR f.name ILIKE '%' || $6 || '%')
               ORDER BY COALESCE(ov.override_score, COALESCE(s.evidence_strength_score, a.trust_score)) DESC,
                        a.evidence_count DESC, f.name
               LIMIT $7::int`,
              [capability, state ?? null, regionStates, district ?? null, signal ?? null, q ?? null, limit, currentUser(req)],
            );
        const results = rows.map((r, i) => {
          const trustSignal = txt(r.trust_signal) as TrustSignal;
          const contradictingCount = Number(r.contradicting_count);
          const reviewFromJson = r.review_recommended === true;
          const reviewReasonFromJson = r.review_reason ? txt(r.review_reason) : null;
          const reviewRecommended =
            reviewFromJson ||
            contradictingCount > 0 ||
            trustSignal === 'weak_suspicious';
          const reviewReason =
            reviewReasonFromJson ??
            (contradictingCount > 0
              ? `${contradictingCount} contradicting evidence item${contradictingCount === 1 ? '' : 's'} on record.`
              : trustSignal === 'weak_suspicious'
                ? 'Low trust signal — planner should confirm with local ground truth.'
                : null);
          return {
            rank: i + 1,
            facilityId: txt(r.facility_id),
            name: txt(r.name),
            type: txt(r.type),
            district: txt(r.district),
            state: txt(r.state),
            stateCode: txt(r.state_code),
            beds: r.beds === null ? null : Number(r.beds),
            lat: r.lat === null ? null : Number(r.lat),
            lon: r.lon === null ? null : Number(r.lon),
            websiteUrl: txt(r.website_url),
            matchConfidence: r.match_confidence === null ? null : Number(r.match_confidence),
            claimed: Boolean(r.claimed),
            trustSignal,
            trustScore: Number(r.trust_score),
            evidenceTier: r.evidence_tier ? txt(r.evidence_tier) : null,
            evidenceCount: Number(r.evidence_count),
            supportingCount: Number(r.supporting_count),
            contradictingCount,
            bestSource: txt(r.best_source),
            summary: txt(r.summary),
            overrideSignal: r.override_signal ? (txt(r.override_signal) as TrustSignal) : null,
            overrideScore: r.override_score === null || r.override_score === undefined ? null : Number(r.override_score),
            overrideNote: r.override_note ? txt(r.override_note) : null,
            reviewRecommended,
            reviewReason: reviewRecommended ? reviewReason : null,
          };
        });
        res.json({ capability, region: parsed.data.region ?? null, state: state ?? null, district: district ?? null, results });
      } catch (err) {
        console.error('facilities failed:', err);
        res.status(500).json({ error: 'Failed to load facilities' });
      }
    });

    // Lightweight facility picker for the facility scorecard — searches by name
    // or district regardless of capability. Registered before ':id' so "search"
    // is not captured as a facility id.
    app.get('/api/facilities/search', async (req, res) => {
      const q = txt(req.query.q).trim();
      try {
        const { rows } = await appkit.lakebase.query(
          `SELECT facility_id, name, type, district, state, state_code, beds
           FROM gold.facilities
           WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR district ILIKE '%' || $1 || '%')
           ORDER BY name
           LIMIT 25`,
          [q || null],
        );
        res.json(
          rows.map((r) => ({
            facilityId: txt(r.facility_id),
            name: txt(r.name),
            type: txt(r.type),
            district: txt(r.district),
            state: txt(r.state),
            stateCode: txt(r.state_code),
            beds: r.beds === null ? null : Number(r.beds),
          })),
        );
      } catch (err) {
        console.error('facility search failed:', err);
        res.status(500).json({ error: 'Failed to search facilities' });
      }
    });

    app.get('/api/facilities/:id', async (req, res) => {
      const id = req.params.id;
      try {
        const [{ rows: fac }, { rows: caps }, { rows: ev }, { rows: ovr }, { rows: scored }, { rows: narrJson }, { rows: narrMd }] =
          await Promise.all([
          appkit.lakebase.query('SELECT * FROM gold.facilities WHERE facility_id = $1', [id]),
          appkit.lakebase.query('SELECT * FROM gold.facility_capability_assessments WHERE facility_id = $1', [id]),
          appkit.lakebase.query(
            'SELECT * FROM gold.capability_evidence WHERE facility_id = $1 ORDER BY weight DESC, observed_at DESC',
            [id],
          ),
          appkit.lakebase.query(
            `SELECT DISTINCT ON (capability) capability, override_signal, override_score, note, created_at
             FROM app.capability_overrides WHERE facility_id = $1 AND created_by = $2
             ORDER BY capability, created_at DESC`,
            [id, currentUser(req)],
          ),
          appkit.lakebase.query(
            'SELECT capability, evidence_strength_score, evidence_tier FROM gold.capability_scored WHERE facility_id = $1',
            [id],
          ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
          appkit.lakebase.query(
            'SELECT capability, assessment_json, model_endpoint, narrated_at FROM gold.capability_evidence_json WHERE facility_id = $1',
            [id],
          ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
          appkit.lakebase.query(
            'SELECT capability, assessment_md, model_endpoint, narrated_at FROM gold.capability_evidence_md WHERE facility_id = $1',
            [id],
          ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
        ]);
        if (fac.length === 0) {
          res.status(404).json({ error: 'Facility not found' });
          return;
        }
        const f = fac[0];
        const overrideByCap = new Map(ovr.map((o) => [txt(o.capability), o]));
        const scoredByCap = new Map(scored.map((s) => [txt(s.capability), s]));
        const jsonByCap = new Map(narrJson.map((j) => [txt(j.capability), j]));
        const mdByCap = new Map(narrMd.map((m) => [txt(m.capability), m]));
        const capByLabel = new Map(CAPABILITIES.map((c) => [c.key, c]));
        const capabilities = CAP_KEYS.map((key) => {
          const c = caps.find((x) => txt(x.capability) === key);
          const meta = capByLabel.get(key)!;
          const o = overrideByCap.get(key);
          const sc = scoredByCap.get(key);
          const nj = jsonByCap.get(key);
          const nm = mdByCap.get(key);
          const assessmentJson = nj?.assessment_json ?? null;
          const evidence = ev
            .filter((e) => txt(e.capability) === key)
            .map((e) => ({
              evidenceId: txt(e.evidence_id),
              sourceType: txt(e.source_type),
              sourceLabel: txt(e.source_label),
              sourceUrl: txt(e.source_url),
              stance: txt(e.stance) as 'supports' | 'contradicts',
              weight: Number(e.weight),
              snippet: txt(e.snippet),
              observedAt: e.observed_at ? txt(e.observed_at).slice(0, 10) : '',
            }));
          return {
            key,
            label: meta.label,
            description: meta.description,
            claimed: c ? Boolean(c.claimed) : false,
            trustScore: sc
              ? Number(sc.evidence_strength_score)
              : c
                ? Number(c.trust_score)
                : 0,
            trustSignal: sc
              ? tierToSignal(txt(sc.evidence_tier))
              : (c ? (txt(c.trust_signal) as TrustSignal) : 'no_claim'),
            evidenceTier: sc ? txt(sc.evidence_tier) : null,
            evidenceCount: c ? Number(c.evidence_count) : 0,
            supportingCount: c ? Number(c.supporting_count) : 0,
            contradictingCount: c ? Number(c.contradicting_count) : 0,
            bestSource: c ? txt(c.best_source) : '',
            summary: c ? txt(c.summary) : `No ${meta.label} claim found for this facility.`,
            assessmentJson:
              assessmentJson && typeof assessmentJson === 'object'
                ? (assessmentJson as Record<string, unknown>)
                : (() => {
                    try {
                      return assessmentJson ? JSON.parse(txt(assessmentJson)) : null;
                    } catch {
                      return null;
                    }
                  })(),
            assessmentMd: nm?.assessment_md ? txt(nm.assessment_md) : null,
            assessmentModel: nj?.model_endpoint
              ? txt(nj.model_endpoint)
              : nm?.model_endpoint
                ? txt(nm.model_endpoint)
                : null,
            assessmentNarratedAt:
              nj?.narrated_at != null
                ? txt(nj.narrated_at).slice(0, 19)
                : nm?.narrated_at != null
                  ? txt(nm.narrated_at).slice(0, 19)
                  : null,
            overrideSignal: o ? (txt(o.override_signal) as TrustSignal) : null,
            overrideScore:
              o?.override_score === null || o?.override_score === undefined ? null : Number(o.override_score),
            overrideNote: o?.note ? txt(o.note) : null,
            evidence,
          };
        });
        res.json({
          facility: {
            facilityId: txt(f.facility_id),
            name: txt(f.name),
            type: txt(f.type),
            district: txt(f.district),
            state: txt(f.state),
            stateCode: txt(f.state_code),
            lat: f.lat === null ? null : Number(f.lat),
            lon: f.lon === null ? null : Number(f.lon),
            beds: f.beds === null ? null : Number(f.beds),
            websiteUrl: txt(f.website_url),
            matchConfidence: f.match_confidence === null ? null : Number(f.match_confidence),
          },
          capabilities,
        });
      } catch (err) {
        console.error('facility detail failed:', err);
        res.status(500).json({ error: 'Failed to load facility' });
      }
    });

    app.get('/api/overrides', async (req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(
          `SELECT DISTINCT ON (facility_id, capability)
              id, facility_id, facility_name, capability,
              original_signal, override_signal, original_score, override_score, note, created_at
           FROM app.capability_overrides
           WHERE created_by = $1
             AND (
               original_signal IS DISTINCT FROM override_signal
               OR original_score IS DISTINCT FROM override_score
             )
           ORDER BY facility_id, capability, created_at DESC`,
          [currentUser(req)],
        );
        rows.sort(
          (a, b) =>
            new Date(txt(b.created_at)).getTime() - new Date(txt(a.created_at)).getTime(),
        );
        res.json(rows);
      } catch (err) {
        console.error('list overrides failed:', err);
        res.status(500).json({ error: 'Failed to load reviews' });
      }
    });

    app.post('/api/overrides', async (req, res) => {
      const parsed = OverrideBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid review', details: parsed.error.flatten() });
        return;
      }
      const { facilityId, capability, overrideSignal, overrideScore, note } = parsed.data;
      const user = currentUser(req);
      try {
        const { rows: ctx } = await appkit.lakebase.query(
          `SELECT f.name,
                  COALESCE(
                    CASE s.evidence_tier
                      WHEN 'Strong' THEN 'strong'
                      WHEN 'Moderate' THEN 'partial'
                      WHEN 'Weak' THEN 'weak_suspicious'
                      WHEN 'Insufficient' THEN 'no_claim'
                    END,
                    a.trust_signal
                  ) AS trust_signal,
                  COALESCE(s.evidence_strength_score, a.trust_score, 0) AS trust_score
           FROM gold.facilities f
           LEFT JOIN gold.facility_capability_assessments a
             ON a.facility_id = f.facility_id AND a.capability = $2
           LEFT JOIN gold.capability_scored s
             ON s.facility_id = f.facility_id AND s.capability = $2
           WHERE f.facility_id = $1`,
          [facilityId, capability],
        );
        if (ctx.length === 0) {
          res.status(404).json({ error: 'Facility not found' });
          return;
        }
        const originalSignal = ctx[0].trust_signal ? txt(ctx[0].trust_signal) : 'no_claim';
        const originalScore = Number(ctx[0].trust_score ?? 0);

        await appkit.lakebase.query(
          `DELETE FROM app.capability_overrides
           WHERE created_by = $1 AND facility_id = $2 AND capability = $3`,
          [user, facilityId, capability],
        );

        if (overrideSignal === originalSignal && scoresEqual(overrideScore, originalScore)) {
          res.status(204).send();
          return;
        }

        const { rows } = await appkit.lakebase.query(
          `INSERT INTO app.capability_overrides
             (created_by, facility_id, capability, facility_name,
              original_signal, override_signal, original_score, override_score, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, facility_id, facility_name, capability,
                     original_signal, override_signal, original_score, override_score, note, created_at`,
          [
            user,
            facilityId,
            capability,
            txt(ctx[0].name),
            originalSignal,
            overrideSignal,
            originalScore,
            overrideScore,
            note ?? null,
          ],
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        console.error('save override failed:', err);
        res.status(500).json({ error: 'Failed to save review' });
      }
    });

    app.delete('/api/overrides/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      try {
        const { rows } = await appkit.lakebase.query(
          'DELETE FROM app.capability_overrides WHERE id = $1 AND created_by = $2 RETURNING id',
          [id, currentUser(req)],
        );
        if (rows.length === 0) {
          res.status(404).json({ error: 'Review not found' });
          return;
        }
        res.status(204).send();
      } catch (err) {
        console.error('delete override failed:', err);
        res.status(500).json({ error: 'Failed to delete review' });
      }
    });

    // ── data quality (web address coverage) ────────────────────────────────────────────────────
    const DataQualityStateQuery = z.object({ state: z.string().optional() });

    const GEO_MAP_COVERAGE_SQL = `
      WITH ${mapStateCtes()},
      ref_districts AS (
        SELECT sc.state AS map_state,
               sc.state_code,
               g.district
        FROM gold.geography g
        JOIN state_codes sc
          ON sc.state = g.state OR sc.state_code = g.state_code
      ),
      fac_by_state AS (
        SELECT map_state,
               MAX(map_state_code) AS map_state_code,
               COUNT(*)::int AS facilities,
               COUNT(*) FILTER (WHERE geography_id IS NOT NULL)::int AS with_geography
        FROM facility_map_state
        GROUP BY map_state
      ),
      fac_by_district AS (
        SELECT f.map_state,
               COALESCE(g.district, f.district) AS district,
               COUNT(*)::int AS facilities,
               COUNT(*) FILTER (WHERE f.geography_id IS NOT NULL)::int AS with_geography
        FROM facility_map_state f
        LEFT JOIN gold.geography g ON g.geography_id = f.geography_id
        WHERE COALESCE(g.district, f.district) IS NOT NULL
          AND TRIM(COALESCE(g.district, f.district)) != ''
        GROUP BY f.map_state, COALESCE(g.district, f.district)
      ),
      district_coverage AS (
        SELECT rd.map_state,
               rd.state_code,
               rd.district,
               COALESCE(fd.facilities, 0)::int AS facilities,
               COALESCE(fd.with_geography, 0)::int AS with_geography,
               (fd.facilities IS NOT NULL) AS mapped
        FROM ref_districts rd
        LEFT JOIN fac_by_district fd
          ON fd.map_state = rd.map_state
         AND lower(fd.district) = lower(rd.district)
      ),
      state_coverage AS (
        SELECT sc.state,
               sc.state_code,
               COUNT(dc.district)::int AS total_districts,
               COUNT(*) FILTER (WHERE dc.mapped)::int AS mapped_districts,
               COALESCE(SUM(dc.facilities), 0)::int AS facilities,
               COALESCE(SUM(dc.with_geography), 0)::int AS with_geography,
               (COUNT(*) FILTER (WHERE dc.mapped) > 0) AS mapped
        FROM state_codes sc
        LEFT JOIN fac_by_state fbs ON fbs.map_state = sc.state
        LEFT JOIN district_coverage dc ON dc.map_state = sc.state
        GROUP BY sc.state, sc.state_code, fbs.facilities
      )
      SELECT
        (SELECT COUNT(*)::int FROM state_codes) AS ref_states,
        (SELECT COUNT(*)::int FROM state_coverage WHERE mapped) AS mapped_states,
        (SELECT COUNT(*)::int FROM ref_districts) AS ref_districts,
        (SELECT COUNT(*)::int FROM district_coverage WHERE mapped) AS mapped_districts,
        (SELECT COUNT(*)::int FROM facility_map_state) AS facilities,
        (SELECT COUNT(*)::int FROM facility_map_state WHERE geography_id IS NOT NULL) AS with_geography,
        (SELECT COUNT(*)::int FROM facility_map_state) AS total_facilities,
        (SELECT COUNT(*)::int FROM facility_map_state) AS nation_mapped_facilities,
        (SELECT COUNT(*)::int
           FROM facility_map_state f
          WHERE EXISTS (SELECT 1 FROM state_codes sc WHERE sc.state = f.map_state)) AS state_mapped_facilities,
        (SELECT COUNT(*)::int
           FROM facility_map_state
          WHERE geography_id IS NOT NULL) AS district_mapped_facilities
    `;

    const GEO_STATE_COVERAGE_SQL = `
      WITH ${mapStateCtes()},
      ref_districts AS (
        SELECT sc.state AS map_state,
               sc.state_code,
               g.district
        FROM gold.geography g
        JOIN state_codes sc
          ON sc.state = g.state OR sc.state_code = g.state_code
      ),
      fac_by_state AS (
        SELECT map_state,
               MAX(map_state_code) AS map_state_code,
               COUNT(*)::int AS facilities,
               COUNT(*) FILTER (WHERE geography_id IS NOT NULL)::int AS with_geography
        FROM facility_map_state
        GROUP BY map_state
      ),
      fac_by_district AS (
        SELECT f.map_state,
               COALESCE(g.district, f.district) AS district,
               COUNT(*)::int AS facilities,
               COUNT(*) FILTER (WHERE f.geography_id IS NOT NULL)::int AS with_geography
        FROM facility_map_state f
        LEFT JOIN gold.geography g ON g.geography_id = f.geography_id
        WHERE COALESCE(g.district, f.district) IS NOT NULL
          AND TRIM(COALESCE(g.district, f.district)) != ''
        GROUP BY f.map_state, COALESCE(g.district, f.district)
      ),
      district_coverage AS (
        SELECT rd.map_state,
               rd.state_code,
               rd.district,
               COALESCE(fd.facilities, 0)::int AS facilities,
               COALESCE(fd.with_geography, 0)::int AS with_geography,
               (fd.facilities IS NOT NULL) AS mapped
        FROM ref_districts rd
        LEFT JOIN fac_by_district fd
          ON fd.map_state = rd.map_state
         AND lower(fd.district) = lower(rd.district)
      )
      SELECT sc.state,
             sc.state_code,
             COUNT(dc.district)::int AS total_districts,
             COUNT(*) FILTER (WHERE dc.mapped)::int AS mapped_districts,
             COALESCE(SUM(dc.facilities), 0)::int AS facilities,
             COALESCE(SUM(dc.with_geography), 0)::int AS with_geography,
             (COUNT(*) FILTER (WHERE dc.mapped) > 0) AS state_mapped
      FROM state_codes sc
      LEFT JOIN fac_by_state fbs ON fbs.map_state = sc.state
      LEFT JOIN district_coverage dc ON dc.map_state = sc.state
      GROUP BY sc.state, sc.state_code, fbs.facilities
      ORDER BY sc.state
    `;

    const pctRate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

    app.get('/api/data-quality', async (_req, res) => {
      try {
        const crawlSubquery = `
          SELECT facility_id,
                 COUNT(*)::int                                        AS crawl_count,
                 COUNT(*) FILTER (WHERE status = 'ok')::int          AS scrape_ok
          FROM bronze.facility_web_crawl
          GROUP BY facility_id`;

        const { rows: sumRows } = await appkit.lakebase.query(`
          SELECT
            COUNT(*)::int                                                                    AS total,
            COUNT(*) FILTER (WHERE f.website_url IS NOT NULL AND f.website_url != '')::int  AS with_url,
            COUNT(*) FILTER (WHERE f.website_url IS NULL  OR  f.website_url = '')::int      AS missing,
            COALESCE(SUM(c.crawl_count), 0)::int                                            AS scrape_total,
            COALESCE(SUM(c.scrape_ok),   0)::int                                            AS scrape_ok
          FROM gold.facilities f
          LEFT JOIN (${crawlSubquery}) c ON c.facility_id = f.facility_id
        `);

        const { rows: stateRows } = await appkit.lakebase.query(`
          SELECT
            f.state,
            f.state_code,
            COUNT(*)::int                                                                    AS total,
            COUNT(*) FILTER (WHERE f.website_url IS NOT NULL AND f.website_url != '')::int  AS with_url,
            COUNT(*) FILTER (WHERE f.website_url IS NULL  OR  f.website_url = '')::int      AS missing,
            COALESCE(SUM(c.scrape_ok),   0)::int                                            AS scrape_ok,
            COALESCE(SUM(c.crawl_count), 0)::int                                            AS scrape_total
          FROM gold.facilities f
          LEFT JOIN (${crawlSubquery}) c ON c.facility_id = f.facility_id
          GROUP BY f.state, f.state_code
          ORDER BY COUNT(*) DESC
        `);

        const { rows: typeRows } = await appkit.lakebase.query(`
          SELECT
            COALESCE(NULLIF(TRIM(f.type), ''), 'Unknown')                                   AS type,
            COUNT(*)::int                                                                    AS total,
            COUNT(*) FILTER (WHERE f.website_url IS NOT NULL AND f.website_url != '')::int  AS with_url,
            COUNT(*) FILTER (WHERE f.website_url IS NULL  OR  f.website_url = '')::int      AS missing
          FROM gold.facilities f
          GROUP BY COALESCE(NULLIF(TRIM(f.type), ''), 'Unknown')
          ORDER BY COUNT(*) DESC
        `);

        const [{ rows: geoSumRows }, { rows: geoStateRows }] = await Promise.all([
          appkit.lakebase.query(GEO_MAP_COVERAGE_SQL),
          appkit.lakebase.query(GEO_STATE_COVERAGE_SQL),
        ]);

        const s = sumRows[0] ?? {};
        const total       = Number(s.total       ?? 0);
        const withUrl     = Number(s.with_url    ?? 0);
        const scrapeTotal = Number(s.scrape_total ?? 0);
        const scrapeOk    = Number(s.scrape_ok    ?? 0);

        const g = geoSumRows[0] ?? {};
        const refStates = Number(g.ref_states ?? 0);
        const mappedStates = Number(g.mapped_states ?? 0);
        const refDistricts = Number(g.ref_districts ?? 0);
        const mappedDistricts = Number(g.mapped_districts ?? 0);
        const totalFacilities = Number(g.total_facilities ?? 0);
        const nationMappedFacilities = Number(g.nation_mapped_facilities ?? 0);
        const districtMappedFacilities = Number(g.district_mapped_facilities ?? 0);

        res.json({
          summary: {
            total,
            withUrl,
            pctWithUrl:  total       > 0 ? Math.round((withUrl   / total)       * 1000) / 10 : 0,
            missing:     Number(s.missing ?? 0),
            scrapeTotal,
            scrapeOk,
            scrapePct:   scrapeTotal > 0 ? Math.round((scrapeOk  / scrapeTotal) * 1000) / 10 : 0,
          },
          byGeography: {
            overall: {
              total: refDistricts,
              mapped: mappedDistricts,
              pct: pctRate(mappedDistricts, refDistricts),
              facilities: totalFacilities,
              withGeography: districtMappedFacilities,
              facilityPct: pctRate(districtMappedFacilities, totalFacilities),
              refStates,
              mappedStates,
              refDistricts,
              mappedDistricts,
            },
            levels: [
              {
                level: 'nation',
                label: 'Level 1 · National',
                name: 'India',
                total: 1,
                mapped: nationMappedFacilities > 0 ? 1 : 0,
                pct: nationMappedFacilities > 0 ? 100 : 0,
                facilities: totalFacilities,
                withGeography: districtMappedFacilities,
                facilityPct: pctRate(districtMappedFacilities, totalFacilities),
              },
              {
                level: 'state',
                label: 'Level 2 · State / UT',
                total: refStates,
                mapped: mappedStates,
                pct: pctRate(mappedStates, refStates),
                facilities: totalFacilities,
                withGeography: districtMappedFacilities,
                facilityPct: pctRate(districtMappedFacilities, totalFacilities),
              },
              {
                level: 'district',
                label: 'Level 3 · District',
                total: refDistricts,
                mapped: mappedDistricts,
                pct: pctRate(mappedDistricts, refDistricts),
                facilities: totalFacilities,
                withGeography: districtMappedFacilities,
                facilityPct: pctRate(districtMappedFacilities, totalFacilities),
              },
            ],
            byState: geoStateRows.map((r) => {
              const totalDistricts = Number(r.total_districts ?? 0);
              const mappedDistrictsCount = Number(r.mapped_districts ?? 0);
              const facilities = Number(r.facilities ?? 0);
              const withGeo = Number(r.with_geography ?? 0);
              return {
                state: txt(r.state),
                stateCode: txt(r.state_code),
                totalDistricts,
                mappedDistricts: mappedDistrictsCount,
                pct: pctRate(withGeo, facilities),
                stateMapped: Boolean(r.state_mapped),
                facilities,
                withGeography: withGeo,
                facilityPct: pctRate(withGeo, facilities),
              };
            }),
          },
          byState: stateRows.map((r) => {
            const t = Number(r.total);
            const w = Number(r.with_url);
            return {
              state:       txt(r.state),
              stateCode:   txt(r.state_code),
              total:       t,
              withUrl:     w,
              missing:     Number(r.missing),
              pct:         t > 0 ? Math.round((w / t) * 1000) / 10 : 0,
              scrapeOk:    Number(r.scrape_ok),
              scrapeTotal: Number(r.scrape_total),
            };
          }),
          byType: typeRows.map((r) => {
            const t = Number(r.total);
            const w = Number(r.with_url);
            return {
              type:    txt(r.type),
              total:   t,
              withUrl: w,
              missing: Number(r.missing),
              pct:     t > 0 ? Math.round((w / t) * 1000) / 10 : 0,
            };
          }),
        });
      } catch (err) {
        console.error('data-quality failed:', err);
        res.status(500).json({ error: 'Failed to load data quality data' });
      }
    });

    app.get('/api/data-quality/missing', async (req, res) => {
      const parsed = DataQualityStateQuery.safeParse(req.query);
      const state = parsed.success ? (parsed.data.state ?? null) : null;
      try {
        const { rows } = await appkit.lakebase.query(
          `SELECT facility_id, name, type, district, state, state_code, beds
           FROM gold.facilities
           WHERE (website_url IS NULL OR website_url = '')
           ${state ? 'AND state = $1' : ''}
           ORDER BY state, district, name
           LIMIT 500`,
          state ? [state] : [],
        );
        res.json(
          rows.map((r) => ({
            facilityId: txt(r.facility_id),
            name:       txt(r.name),
            type:       txt(r.type),
            district:   txt(r.district),
            state:      txt(r.state),
            stateCode:  txt(r.state_code),
            beds:       r.beds === null ? null : Number(r.beds),
          })),
        );
      } catch (err) {
        console.error('data-quality/missing failed:', err);
        res.status(500).json({ error: 'Failed to load missing facilities' });
      }
    });

    app.get('/api/data-quality/unmapped-districts', async (req, res) => {
      const parsed = DataQualityStateQuery.safeParse(req.query);
      const state = parsed.success ? (parsed.data.state ?? null) : null;
      if (!state) {
        res.status(400).json({ error: 'state is required' });
        return;
      }
      try {
        const { rows } = await appkit.lakebase.query(
          `WITH ${mapStateCtes()},
          ref_districts AS (
            SELECT sc.state AS map_state, g.district
            FROM gold.geography g
            JOIN state_codes sc
              ON sc.state = g.state OR sc.state_code = g.state_code
            WHERE sc.state = $1
          ),
          fac_by_district AS (
            SELECT f.map_state, COALESCE(g.district, f.district) AS district
            FROM facility_map_state f
            LEFT JOIN gold.geography g ON g.geography_id = f.geography_id
            WHERE f.map_state = $1
              AND COALESCE(g.district, f.district) IS NOT NULL
              AND TRIM(COALESCE(g.district, f.district)) != ''
            GROUP BY f.map_state, COALESCE(g.district, f.district)
          )
          SELECT rd.district
          FROM ref_districts rd
          WHERE NOT EXISTS (
            SELECT 1 FROM fac_by_district fd
            WHERE fd.map_state = rd.map_state
              AND lower(fd.district) = lower(rd.district)
          )
          ORDER BY rd.district`,
          [state],
        );
        res.json(rows.map((r) => ({ district: txt(r.district) })));
      } catch (err) {
        console.error('data-quality/unmapped-districts failed:', err);
        res.status(500).json({ error: 'Failed to load unmapped districts' });
      }
    });

    const MergeReviewBody = z.object({
      candidateId: z.string().min(1),
      decision: z.enum(['merge', 'reject', 'defer']),
      note: z.string().optional(),
    });

    const WebsiteUrlBody = z.object({
      facilityId: z.string().min(1),
      newUrl: z.string().min(1),
      note: z.string().optional(),
    });

    app.get('/api/data-quality/flags', async (req, res) => {
      const parsed = DataQualityStateQuery.safeParse(req.query);
      const state = parsed.success ? (parsed.data.state ?? null) : null;
      const flagType = typeof req.query.type === 'string' ? req.query.type : null;
      const params: unknown[] = [];
      const clauses = ["dq.status = 'open'"];
      if (state) {
        params.push(state);
        clauses.push(`f.state = $${params.length}`);
      }
      if (flagType) {
        params.push(flagType);
        clauses.push(`dq.flag_type = $${params.length}`);
      }
      try {
        const { rows } = await appkit.lakebase.query(
          `SELECT dq.id, dq.facility_id, dq.flag_type, dq.severity, dq.detail,
                  dq.related_id, dq.status, dq.created_at,
                  f.name AS facility_name, f.state, f.state_code, f.district
           FROM app.data_quality_flags dq
           LEFT JOIN gold.facilities f ON f.facility_id = dq.facility_id
           WHERE ${clauses.join(' AND ')}
           ORDER BY
             CASE dq.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
             dq.created_at DESC
           LIMIT 500`,
          params,
        );
        res.json(
          rows.map((r) => ({
            id: Number(r.id),
            facilityId: txt(r.facility_id),
            facilityName: txt(r.facility_name),
            flagType: txt(r.flag_type),
            severity: txt(r.severity),
            detail: txt(r.detail),
            relatedId: r.related_id ? txt(r.related_id) : null,
            status: txt(r.status),
            createdAt: r.created_at,
            state: txt(r.state),
            stateCode: txt(r.state_code),
            district: txt(r.district),
          })),
        );
      } catch (err) {
        if (isMissingRelation(err)) {
          res.json([]);
          return;
        }
        console.error('data-quality/flags failed:', err);
        res.status(500).json({ error: 'Failed to load data quality flags' });
      }
    });

    app.get('/api/data-quality/flag-summary', async (_req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(`
          SELECT flag_type, COUNT(*)::int AS count
          FROM app.data_quality_flags
          WHERE status = 'open'
          GROUP BY flag_type
        `);
        const byType: Record<string, number> = {};
        for (const r of rows) byType[txt(r.flag_type)] = Number(r.count ?? 0);

        const { rows: dupRows } = await appkit.lakebase.query(`
          SELECT COUNT(*)::int AS pending
          FROM bronze.merge_candidates mc
          WHERE mc.match_probability >= 0.55
            AND NOT EXISTS (
              SELECT 1 FROM app.merge_reviews mr
              WHERE mr.candidate_id = mc.candidate_id
                AND mr.decision IN ('merge', 'reject')
            )
        `);
        res.json({
          byType,
          pendingMergeReviews: Number(dupRows[0]?.pending ?? 0),
          totalOpen: Object.values(byType).reduce((a, b) => a + b, 0),
        });
      } catch (err) {
        if (isMissingRelation(err)) {
          res.json({ byType: {}, pendingMergeReviews: 0, totalOpen: 0 });
          return;
        }
        console.error('data-quality/flag-summary failed:', err);
        res.status(500).json({ error: 'Failed to load flag summary' });
      }
    });

    app.get('/api/data-quality/duplicates', async (req, res) => {
      const parsed = DataQualityStateQuery.safeParse(req.query);
      const state = parsed.success ? (parsed.data.state ?? null) : null;
      try {
        const { rows } = await appkit.lakebase.query(
          `SELECT mc.*,
                  lr.decision AS review_decision,
                  lr.note AS review_note,
                  lr.created_at AS reviewed_at,
                  lr.reviewed_by
           FROM bronze.merge_candidates mc
           LEFT JOIN LATERAL (
             SELECT decision, note, created_at, reviewed_by
             FROM app.merge_reviews
             WHERE candidate_id = mc.candidate_id
             ORDER BY created_at DESC
             LIMIT 1
           ) lr ON TRUE
           WHERE mc.match_probability >= 0.55
             ${state ? 'AND mc.state = $1' : ''}
           ORDER BY mc.match_probability DESC, mc.computed_at DESC
           LIMIT 500`,
          state ? [state] : [],
        );
        res.json(
          rows.map((r) => ({
            candidateId: txt(r.candidate_id),
            leftSource: txt(r.left_source),
            leftId: txt(r.left_id),
            leftName: txt(r.left_name),
            rightSource: txt(r.right_source),
            rightId: txt(r.right_id),
            rightName: txt(r.right_name),
            matchProbability: Number(r.match_probability),
            matchWeight: r.match_weight == null ? null : Number(r.match_weight),
            state: txt(r.state),
            district: r.district ? txt(r.district) : null,
            recommendation: txt(r.recommendation),
            flagReason: txt(r.flag_reason),
            computedAt: r.computed_at,
            reviewDecision: r.review_decision ? txt(r.review_decision) : null,
            reviewNote: r.review_note ? txt(r.review_note) : null,
            reviewedAt: r.reviewed_at ?? null,
            reviewedBy: r.reviewed_by ? txt(r.reviewed_by) : null,
          })),
        );
      } catch (err) {
        if (isMissingRelation(err)) {
          res.json([]);
          return;
        }
        console.error('data-quality/duplicates failed:', err);
        res.status(500).json({ error: 'Failed to load duplicate candidates' });
      }
    });

    app.post('/api/data-quality/merge-reviews', async (req, res) => {
      const parsed = MergeReviewBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid merge review payload' });
        return;
      }
      const user = currentUser(req);
      const { candidateId, decision, note } = parsed.data;
      try {
        const { rows } = await appkit.lakebase.query(
          `INSERT INTO app.merge_reviews (candidate_id, decision, reviewed_by, note)
           VALUES ($1, $2, $3, $4)
           RETURNING id, candidate_id, decision, reviewed_by, note, created_at`,
          [candidateId, decision, user, note?.trim() || null],
        );
        if (decision === 'merge' || decision === 'reject') {
          await appkit.lakebase.query(
            `UPDATE app.data_quality_flags
             SET status = 'resolved', resolved_at = NOW(), resolved_by = $2
             WHERE related_id = $1 AND flag_type = 'duplicate_pair' AND status = 'open'`,
            [candidateId, user],
          );
        }
        const r = rows[0];
        res.status(201).json({
          id: Number(r.id),
          candidateId: txt(r.candidate_id),
          decision: txt(r.decision),
          reviewedBy: txt(r.reviewed_by),
          note: r.note ? txt(r.note) : null,
          createdAt: r.created_at,
        });
      } catch (err) {
        console.error('data-quality/merge-reviews failed:', err);
        res.status(500).json({ error: 'Failed to save merge review' });
      }
    });

    app.get('/api/data-quality/merge-reviews', async (req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(
          `SELECT mr.id, mr.candidate_id, mr.decision, mr.reviewed_by, mr.note, mr.created_at,
                  mc.left_source, mc.left_id, mc.left_name,
                  mc.right_source, mc.right_id, mc.right_name,
                  mc.match_probability, mc.recommendation
           FROM app.merge_reviews mr
           JOIN bronze.merge_candidates mc ON mc.candidate_id = mr.candidate_id
           WHERE mr.reviewed_by = $1
           ORDER BY mr.created_at DESC
           LIMIT 200`,
          [currentUser(req)],
        );
        res.json(
          rows.map((r) => ({
            id: Number(r.id),
            candidateId: txt(r.candidate_id),
            decision: txt(r.decision),
            reviewedBy: txt(r.reviewed_by),
            note: r.note ? txt(r.note) : null,
            createdAt: r.created_at,
            leftSource: txt(r.left_source),
            leftId: txt(r.left_id),
            leftName: txt(r.left_name),
            rightSource: txt(r.right_source),
            rightId: txt(r.right_id),
            rightName: txt(r.right_name),
            matchProbability: Number(r.match_probability),
            recommendation: txt(r.recommendation),
          })),
        );
      } catch (err) {
        console.error('data-quality/merge-reviews list failed:', err);
        res.status(500).json({ error: 'Failed to load merge reviews' });
      }
    });

    app.post('/api/data-quality/website-url', async (req, res) => {
      const parsed = WebsiteUrlBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid website URL payload' });
        return;
      }
      const user = currentUser(req);
      const { facilityId, newUrl, note } = parsed.data;
      const trimmedUrl = newUrl.trim();
      try {
        const { rows: facRows } = await appkit.lakebase.query(
          `SELECT facility_id, name, website_url FROM gold.facilities WHERE facility_id = $1`,
          [facilityId],
        );
        if (facRows.length === 0) {
          res.status(404).json({ error: 'Facility not found' });
          return;
        }
        const fac = facRows[0];
        const oldUrl = fac.website_url ? txt(fac.website_url) : null;

        await appkit.lakebase.query(
          `UPDATE bronze.facilities_virtue SET website_url = $2 WHERE facility_id = $1`,
          [facilityId, trimmedUrl],
        );

        const { rows } = await appkit.lakebase.query(
          `INSERT INTO app.website_url_updates
             (facility_id, facility_name, old_url, new_url, reviewed_by, note)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, facility_id, facility_name, old_url, new_url, reviewed_by, note, created_at`,
          [facilityId, txt(fac.name), oldUrl, trimmedUrl, user, note?.trim() || null],
        );

        await appkit.lakebase.query(
          `UPDATE app.data_quality_flags
           SET status = 'resolved', resolved_at = NOW(), resolved_by = $2
           WHERE facility_id = $1 AND flag_type = 'missing_url' AND status = 'open'`,
          [facilityId, user],
        );

        const r = rows[0];
        res.status(201).json({
          id: Number(r.id),
          facilityId: txt(r.facility_id),
          facilityName: txt(r.facility_name),
          oldUrl: r.old_url ? txt(r.old_url) : null,
          newUrl: txt(r.new_url),
          reviewedBy: txt(r.reviewed_by),
          note: r.note ? txt(r.note) : null,
          createdAt: r.created_at,
        });
      } catch (err) {
        console.error('data-quality/website-url failed:', err);
        res.status(500).json({ error: 'Failed to update website URL' });
      }
    });

    app.get('/api/data-quality/website-url-updates', async (req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(
          `SELECT id, facility_id, facility_name, old_url, new_url, reviewed_by, note, created_at
           FROM app.website_url_updates
           WHERE reviewed_by = $1
           ORDER BY created_at DESC
           LIMIT 200`,
          [currentUser(req)],
        );
        res.json(
          rows.map((r) => ({
            id: Number(r.id),
            facilityId: txt(r.facility_id),
            facilityName: txt(r.facility_name),
            oldUrl: r.old_url ? txt(r.old_url) : null,
            newUrl: txt(r.new_url),
            reviewedBy: txt(r.reviewed_by),
            note: r.note ? txt(r.note) : null,
            createdAt: r.created_at,
          })),
        );
      } catch (err) {
        console.error('data-quality/website-url-updates failed:', err);
        res.status(500).json({ error: 'Failed to load website URL updates' });
      }
    });
  });
}
