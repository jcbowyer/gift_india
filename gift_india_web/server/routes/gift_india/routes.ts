import { z } from 'zod';
import { Application, Request } from 'express';

interface LakebaseQuery {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

interface AppKitWithLakebase {
  lakebase: LakebaseQuery;
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const SETUP_SQL = `
  CREATE SCHEMA IF NOT EXISTS app;
  CREATE TABLE IF NOT EXISTS app.placement_plans (
    id SERIAL PRIMARY KEY,
    created_by TEXT,
    team_label TEXT NOT NULL,
    specialty TEXT NOT NULL,
    rural_preference TEXT NOT NULL,
    team_size INTEGER,
    days INTEGER,
    district TEXT NOT NULL,
    state TEXT NOT NULL,
    score NUMERIC,
    population BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// Need + gap scoring over the gold serving tables (gold.geography + gold.facilities).
// Serving reads gold only — never the raw bronze landing tables.
// need_score (0..1): low c-section rate and institutional birth rate signal weak surgical
// access; high unmet family-planning need and anaemia signal weak health systems.
const RECOMMEND_SQL = `
  WITH spec AS (
    SELECT LOWER(district) AS dk, LOWER(state) AS sk,
           COUNT(*) FILTER (WHERE offers_surgery AND specialties ILIKE $1) AS spec_facilities,
           COALESCE(SUM(annual_surgeries) FILTER (WHERE offers_surgery AND specialties ILIKE $1), 0) AS spec_capacity,
           COUNT(*) FILTER (WHERE offers_surgery) AS any_surgical_facilities
    FROM gold.facilities
    GROUP BY 1, 2
  ),
  scored AS (
    SELECT
      d.district, d.state, d.lat, d.lon, d.population, d.urbanity,
      d.institutional_birth_pct, d.csection_pct, d.fp_unmet_pct, d.anaemia_pct,
      COALESCE(s.spec_facilities, 0) AS spec_facilities,
      COALESCE(s.spec_capacity, 0) AS spec_capacity,
      COALESCE(s.any_surgical_facilities, 0) AS any_surgical_facilities,
      ( 0.45 * GREATEST(0, LEAST(1, (35 - COALESCE(d.csection_pct, 0)) / 35.0))
      + 0.25 * GREATEST(0, LEAST(1, (100 - COALESCE(d.institutional_birth_pct, 0)) / 100.0))
      + 0.15 * GREATEST(0, LEAST(1, COALESCE(d.fp_unmet_pct, 0) / 30.0))
      + 0.15 * GREATEST(0, LEAST(1, COALESCE(d.anaemia_pct, 0) / 100.0)) ) AS need_score,
      1.0 / (1 + COALESCE(s.spec_facilities, 0)) AS gap_score,
      LEAST(1.0, COALESCE(d.population, 0) / 3000000.0) AS reach_score,
      CASE
        WHEN $2 = 'rural' THEN GREATEST(0.05, 1 - COALESCE(d.urbanity, 0.5))
        WHEN $2 = 'urban' THEN GREATEST(0.05, COALESCE(d.urbanity, 0.5))
        ELSE 1
      END AS access_factor
    FROM gold.geography d
    LEFT JOIN spec s ON s.dk = LOWER(d.district) AND s.sk = LOWER(d.state)
  )
  SELECT *,
    (need_score * gap_score * (0.3 + 0.7 * reach_score) * access_factor) AS raw_score
  FROM scored
  ORDER BY raw_score DESC
  LIMIT $3
`;

const STATS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM gold.geography) AS districts,
    (SELECT COUNT(*) FROM gold.facilities WHERE offers_surgery) AS surgical_facilities,
    (SELECT COALESCE(SUM(annual_surgeries), 0) FROM gold.facilities WHERE offers_surgery) AS annual_surgeries,
    (SELECT COALESCE(SUM(population), 0) FROM gold.geography) AS population_covered,
    (SELECT COUNT(*) FROM gold.geography WHERE surgical_facility_count = 0) AS desert_districts
`;

const SPECIALTIES_SQL = `
  SELECT TRIM(s) AS specialty, COUNT(*) AS facilities
  FROM gold.facilities, LATERAL unnest(string_to_array(specialties, '|')) AS s
  WHERE offers_surgery AND TRIM(s) <> ''
  GROUP BY 1
  ORDER BY 2 DESC
`;

const DISTRICTS_SQL = `
  SELECT d.district, d.state, d.lat, d.lon, d.population,
         d.csection_pct, d.institutional_birth_pct, d.fp_unmet_pct, d.anaemia_pct, d.urbanity,
         d.surgical_facility_count AS surgical_facilities
  FROM gold.geography d
  WHERE d.lat IS NOT NULL AND d.lon IS NOT NULL
`;

const RecommendBody = z.object({
  specialty: z.string().min(1),
  ruralPreference: z.enum(['rural', 'urban', 'any']).default('any'),
  teamSize: z.number().int().positive().max(50).default(3),
  days: z.number().int().positive().max(60).default(5),
  limit: z.number().int().positive().max(50).default(10),
});

const SavePlanBody = z.object({
  teamLabel: z.string().min(1).max(200),
  specialty: z.string().min(1),
  ruralPreference: z.string().min(1),
  teamSize: z.number().int().positive().max(50),
  days: z.number().int().positive().max(60),
  district: z.string().min(1),
  state: z.string().min(1),
  score: z.number(),
  population: z.number().int().nonnegative().optional(),
});

function currentUser(req: Request): string {
  return req.header('x-forwarded-email') || req.header('x-forwarded-user') || 'local-dev@gift_india';
}

export async function setupgift_indiaRoutes(appkit: AppKitWithLakebase) {
  try {
    await appkit.lakebase.query(SETUP_SQL);
    console.log('[gift_india] app.placement_plans ready');
  } catch (err) {
    console.warn('[gift_india] schema setup failed:', (err as Error).message);
    console.warn('[gift_india] Deploy the app first so its service principal owns the app schema.');
  }

  appkit.server.extend((app) => {
    app.get('/api/whoami', (req, res) => {
      res.json({ email: currentUser(req) });
    });

    app.get('/api/stats', async (_req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(STATS_SQL);
        res.json(rows[0] ?? {});
      } catch (err) {
        console.error('stats failed:', err);
        res.status(500).json({ error: 'Failed to load stats' });
      }
    });

    app.get('/api/specialties', async (_req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(SPECIALTIES_SQL);
        res.json(rows);
      } catch (err) {
        console.error('specialties failed:', err);
        res.status(500).json({ error: 'Failed to load specialties' });
      }
    });

    app.get('/api/districts', async (_req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(DISTRICTS_SQL);
        res.json(rows);
      } catch (err) {
        console.error('districts failed:', err);
        res.status(500).json({ error: 'Failed to load districts' });
      }
    });

    app.post('/api/recommend', async (req, res) => {
      const parsed = RecommendBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
        return;
      }
      const { specialty, ruralPreference, limit } = parsed.data;
      try {
        const { rows } = await appkit.lakebase.query(RECOMMEND_SQL, [
          `%${specialty}%`,
          ruralPreference,
          limit,
        ]);
        const maxScore = rows.reduce((m, r) => Math.max(m, Number(r.raw_score) || 0), 0) || 1;
        const ranked = rows.map((r, i) => ({
          rank: i + 1,
          district: r.district,
          state: r.state,
          lat: Number(r.lat),
          lon: Number(r.lon),
          population: Number(r.population),
          urbanity: Number(r.urbanity),
          specFacilities: Number(r.spec_facilities),
          specCapacity: Number(r.spec_capacity),
          anySurgicalFacilities: Number(r.any_surgical_facilities),
          csectionPct: r.csection_pct === null ? null : Number(r.csection_pct),
          institutionalBirthPct: r.institutional_birth_pct === null ? null : Number(r.institutional_birth_pct),
          fpUnmetPct: r.fp_unmet_pct === null ? null : Number(r.fp_unmet_pct),
          anaemiaPct: r.anaemia_pct === null ? null : Number(r.anaemia_pct),
          needScore: Number(r.need_score),
          gapScore: Number(r.gap_score),
          reachScore: Number(r.reach_score),
          score: Math.round((Number(r.raw_score) / maxScore) * 100),
        }));
        res.json({ specialty, ruralPreference, results: ranked });
      } catch (err) {
        console.error('recommend failed:', err);
        res.status(500).json({ error: 'Failed to compute recommendations' });
      }
    });

    app.get('/api/plans', async (req, res) => {
      try {
        const { rows } = await appkit.lakebase.query(
          `SELECT id, created_by, team_label, specialty, rural_preference, team_size, days,
                  district, state, score, population, created_at
           FROM app.placement_plans
           WHERE created_by = $1
           ORDER BY created_at DESC
           LIMIT 100`,
          [currentUser(req)],
        );
        res.json(rows);
      } catch (err) {
        console.error('list plans failed:', err);
        res.status(500).json({ error: 'Failed to load saved plans' });
      }
    });

    app.post('/api/plans', async (req, res) => {
      const parsed = SavePlanBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid plan', details: parsed.error.flatten() });
        return;
      }
      const p = parsed.data;
      try {
        const { rows } = await appkit.lakebase.query(
          `INSERT INTO app.placement_plans
             (created_by, team_label, specialty, rural_preference, team_size, days, district, state, score, population)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, created_by, team_label, specialty, rural_preference, team_size, days, district, state, score, population, created_at`,
          [
            currentUser(req),
            p.teamLabel,
            p.specialty,
            p.ruralPreference,
            p.teamSize,
            p.days,
            p.district,
            p.state,
            p.score,
            p.population ?? null,
          ],
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        console.error('save plan failed:', err);
        res.status(500).json({ error: 'Failed to save plan' });
      }
    });

    app.delete('/api/plans/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      try {
        const { rows } = await appkit.lakebase.query(
          'DELETE FROM app.placement_plans WHERE id = $1 AND created_by = $2 RETURNING id',
          [id, currentUser(req)],
        );
        if (rows.length === 0) {
          res.status(404).json({ error: 'Plan not found' });
          return;
        }
        res.status(204).send();
      } catch (err) {
        console.error('delete plan failed:', err);
        res.status(500).json({ error: 'Failed to delete plan' });
      }
    });
  });
}
