import { z } from 'zod';
import { Application, Request } from 'express';
import { CAPABILITIES, type TrustSignal } from './capabilities';

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
                  f.website_url, f.match_confidence,
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
