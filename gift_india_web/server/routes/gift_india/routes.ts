import { z } from 'zod';
import { Application, Request } from 'express';
import { CAPABILITIES, type TrustSignal } from './capabilities';
import { regionOf, type Region } from './regions';

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
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
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
  capability: z.enum(CAP_KEYS as [string, ...string[]]),
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
  note: z.string().max(2000).optional(),
});

export async function setupgift_indiaRoutes(appkit: AppKitWithLakebase) {
  try {
    await appkit.lakebase.query(SETUP_SQL);
    await assertGoldServingTables(appkit.lakebase);
  } catch (err) {
    console.warn('[trust-desk] gold serving check failed:', (err as Error).message);
  }

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
        const out = CAPABILITIES.map((c) => {
          const r = byKey.get(c.key) ?? {};
          return {
            key: c.key,
            label: c.label,
            description: c.description,
            claiming: Number(r.claiming ?? 0),
            strong: Number(r.strong ?? 0),
            partial: Number(r.partial ?? 0),
            weak: Number(r.weak ?? 0),
            noClaim: Number(r.no_claim ?? 0),
          };
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
      if (!(CAP_KEYS as readonly string[]).includes(capability)) {
        res.status(400).json({ error: 'Invalid capability' });
        return;
      }
      try {
        const agg = `
            COUNT(*)::int                                                  AS facilities,
            COUNT(*) FILTER (WHERE a.claimed)::int                         AS claiming,
            AVG(a.trust_score) FILTER (WHERE a.claimed)                    AS avg_score,
            COUNT(*) FILTER (WHERE a.trust_signal = 'strong')::int         AS strong,
            COUNT(*) FILTER (WHERE a.trust_signal = 'partial')::int        AS partial,
            COUNT(*) FILTER (WHERE a.trust_signal = 'weak_suspicious')::int AS weak`;
        const [{ rows: states }, { rows: districts }] = await Promise.all([
          appkit.lakebase.query(
            `SELECT f.state, MAX(f.state_code) AS state_code, ${agg}
             FROM gold.facilities f
             JOIN gold.facility_capability_assessments a
               ON a.facility_id = f.facility_id AND a.capability = $1
             GROUP BY f.state`,
            [capability],
          ),
          appkit.lakebase.query(
            `SELECT f.state, f.district, MAX(f.state_code) AS state_code,
                    MAX(g.lat) AS lat, MAX(g.lon) AS lon, MAX(g.population)::bigint AS population, ${agg}
             FROM gold.facilities f
             JOIN gold.facility_capability_assessments a
               ON a.facility_id = f.facility_id AND a.capability = $1
             LEFT JOIN gold.geography g ON g.district = f.district AND g.state = f.state
             GROUP BY f.state, f.district`,
            [capability],
          ),
        ]);
        const region = (r: Record<string, unknown>) => ({
          facilities: Number(r.facilities ?? 0),
          claiming: Number(r.claiming ?? 0),
          avgScore: r.avg_score === null || r.avg_score === undefined ? null : Number(r.avg_score),
          strong: Number(r.strong ?? 0),
          partial: Number(r.partial ?? 0),
          weak: Number(r.weak ?? 0),
        });
        res.json({
          capability,
          states: states.map((r) => ({ state: txt(r.state), stateCode: txt(r.state_code), ...region(r) })),
          districts: districts.map((r) => ({
            state: txt(r.state),
            district: txt(r.district),
            stateCode: txt(r.state_code),
            lat: r.lat === null ? null : Number(r.lat),
            lon: r.lon === null ? null : Number(r.lon),
            population: r.population === null ? null : Number(r.population),
            ...region(r),
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
      try {
        const { rows } = await appkit.lakebase.query(
          `SELECT f.facility_id, f.name, f.type, f.district, f.state, f.state_code, f.beds,
                  f.lat, f.lon, f.website_url, f.match_confidence,
                  a.claimed, a.trust_signal, a.trust_score, a.evidence_count,
                  a.supporting_count, a.contradicting_count, a.best_source, a.summary,
                  ov.override_signal, ov.note AS override_note
           FROM gold.facility_capability_assessments a
           JOIN gold.facilities f USING (facility_id)
           LEFT JOIN LATERAL (
             SELECT override_signal, note FROM app.capability_overrides o
             WHERE o.facility_id = f.facility_id AND o.capability = a.capability AND o.created_by = $7
             ORDER BY o.created_at DESC LIMIT 1
           ) ov ON TRUE
           WHERE a.capability = $1
             AND ($2::text IS NULL OR f.state = $2)
             AND ($3::text IS NULL OR f.district = $3)
             AND (a.trust_signal = $4 OR ($4::text IS NULL AND a.trust_signal <> 'no_claim'))
             AND ($5::text IS NULL OR f.name ILIKE '%' || $5 || '%')
           ORDER BY a.trust_score DESC, a.evidence_count DESC, f.name
           LIMIT $6`,
          [capability, state ?? null, district ?? null, signal ?? null, q ?? null, limit, currentUser(req)],
        );
        const results = rows.map((r, i) => ({
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
          trustSignal: txt(r.trust_signal) as TrustSignal,
          trustScore: Number(r.trust_score),
          evidenceCount: Number(r.evidence_count),
          supportingCount: Number(r.supporting_count),
          contradictingCount: Number(r.contradicting_count),
          bestSource: txt(r.best_source),
          summary: txt(r.summary),
          overrideSignal: r.override_signal ? (txt(r.override_signal) as TrustSignal) : null,
          overrideNote: r.override_note ? txt(r.override_note) : null,
        }));
        res.json({ capability, state: state ?? null, district: district ?? null, results });
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
        const [{ rows: fac }, { rows: caps }, { rows: ev }, { rows: ovr }] = await Promise.all([
          appkit.lakebase.query('SELECT * FROM gold.facilities WHERE facility_id = $1', [id]),
          appkit.lakebase.query('SELECT * FROM gold.facility_capability_assessments WHERE facility_id = $1', [id]),
          appkit.lakebase.query(
            'SELECT * FROM gold.capability_evidence WHERE facility_id = $1 ORDER BY weight DESC, observed_at DESC',
            [id],
          ),
          appkit.lakebase.query(
            `SELECT DISTINCT ON (capability) capability, override_signal, note, created_at
             FROM app.capability_overrides WHERE facility_id = $1 AND created_by = $2
             ORDER BY capability, created_at DESC`,
            [id, currentUser(req)],
          ),
        ]);
        if (fac.length === 0) {
          res.status(404).json({ error: 'Facility not found' });
          return;
        }
        const f = fac[0];
        const overrideByCap = new Map(ovr.map((o) => [txt(o.capability), o]));
        const capByLabel = new Map(CAPABILITIES.map((c) => [c.key, c]));
        const capabilities = CAP_KEYS.map((key) => {
          const c = caps.find((x) => txt(x.capability) === key);
          const meta = capByLabel.get(key)!;
          const o = overrideByCap.get(key);
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
            trustSignal: (c ? txt(c.trust_signal) : 'no_claim') as TrustSignal,
            trustScore: c ? Number(c.trust_score) : 0,
            evidenceCount: c ? Number(c.evidence_count) : 0,
            supportingCount: c ? Number(c.supporting_count) : 0,
            contradictingCount: c ? Number(c.contradicting_count) : 0,
            bestSource: c ? txt(c.best_source) : '',
            summary: c ? txt(c.summary) : `No ${meta.label} claim found for this facility.`,
            overrideSignal: o ? (txt(o.override_signal) as TrustSignal) : null,
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
          `SELECT id, facility_id, facility_name, capability, original_signal, override_signal, note, created_at
           FROM app.capability_overrides
           WHERE created_by = $1
           ORDER BY created_at DESC
           LIMIT 200`,
          [currentUser(req)],
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
      const { facilityId, capability, overrideSignal, note } = parsed.data;
      try {
        const { rows: ctx } = await appkit.lakebase.query(
          `SELECT f.name, a.trust_signal
           FROM gold.facilities f
           LEFT JOIN gold.facility_capability_assessments a
             ON a.facility_id = f.facility_id AND a.capability = $2
           WHERE f.facility_id = $1`,
          [facilityId, capability],
        );
        if (ctx.length === 0) {
          res.status(404).json({ error: 'Facility not found' });
          return;
        }
        const { rows } = await appkit.lakebase.query(
          `INSERT INTO app.capability_overrides
             (created_by, facility_id, capability, facility_name, original_signal, override_signal, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, facility_id, facility_name, capability, original_signal, override_signal, note, created_at`,
          [
            currentUser(req),
            facilityId,
            capability,
            txt(ctx[0].name),
            ctx[0].trust_signal ? txt(ctx[0].trust_signal) : 'no_claim',
            overrideSignal,
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
  });
}
