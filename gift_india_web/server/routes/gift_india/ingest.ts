import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Application, Request, Response } from 'express';

interface LakebaseQuery {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

interface IngestAppKit {
  lakebase: LakebaseQuery;
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const NHPR_DATA_DIR = path.join(REPO_ROOT, 'data', 'nhpr');
const MEDICAL_TRAVEL_DATA_DIR = path.join(REPO_ROOT, 'data', 'medical_travel');
const API_DIR = path.join(REPO_ROOT, 'gift_india_api');

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function runPythonModule(
  module: string,
  args: string[] = [],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('python3', ['-m', module, ...args], {
      cwd: API_DIR,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export async function setupIngestRoutes(appkit: IngestAppKit): Promise<void> {
  appkit.server.extend((app) => {
    app.get('/api/ingest/nhpr/status', async (_req: Request, res: Response) => {
      try {
        const manifestPath = path.join(NHPR_DATA_DIR, 'manifest.json');
        const hasManifest = await fileExists(manifestPath);
        const manifest = hasManifest
          ? JSON.parse(await readFile(manifestPath, 'utf-8'))
          : null;

        let bronzeCount: number | null = null;
        try {
          const { rows } = await appkit.lakebase.query(
            `SELECT COUNT(*)::int AS count
             FROM bronze.locations_nhpr`,
          );
          bronzeCount = Number(rows[0]?.count ?? 0);
        } catch {
          bronzeCount = null;
        }

        res.json({
          dataDir: NHPR_DATA_DIR,
          manifest,
          bronzeCount,
          mode: 'web_scrape',
          credentialsOptional: true,
        });
      } catch (err) {
        console.error('nhpr status failed:', err);
        res.status(500).json({ error: 'Failed to read NHPR ingest status' });
      }
    });

    app.get('/api/ingest/nhpr/facilities', async (req: Request, res: Response) => {
      try {
        const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 500);
        const offset = Math.max(Number(req.query.offset ?? 0), 0);
        const state = typeof req.query.state === 'string' ? req.query.state : null;
        const minBeds = req.query.minBeds != null ? Number(req.query.minBeds) : null;

        const clauses: string[] = [];
        const params: unknown[] = [];
        if (state) {
          params.push(state);
          clauses.push(`state_name ILIKE $${params.length}`);
        }
        if (minBeds != null && !Number.isNaN(minBeds)) {
          params.push(minBeds);
          clauses.push(`COALESCE(total_beds, 0) >= $${params.length}`);
        }
        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

        params.push(limit, offset);
        const { rows } = await appkit.lakebase.query(
          `SELECT
             nhpr_facility_id,
             facility_name,
             facility_type,
             state_name,
             district_name,
             address,
             pincode,
             total_beds,
             icu_beds_with_ventilators,
             icu_beds_without_ventilators,
             latitude,
             longitude,
             collected_at
           FROM bronze.locations_nhpr
           ${where}
           ORDER BY state_name, facility_name
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );
        res.json({ facilities: rows, limit, offset });
      } catch (err) {
        console.error('nhpr facilities query failed:', err);
        res.status(500).json({
          error:
            'bronze.locations_nhpr is unavailable — run `make nhpr-scrape && make load-nhpr` first.',
        });
      }
    });

    app.post('/api/ingest/nhpr/scrape', async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const args: string[] = [];
      if (body.resume === true) args.push('--resume');
      if (body.maxStates != null) args.push('--max-states', String(body.maxStates));
      if (body.maxPages != null) args.push('--max-pages', String(body.maxPages));
      if (Array.isArray(body.searchTokens) && body.searchTokens.length) {
        args.push('--search-tokens', ...body.searchTokens.map(String));
      }
      if (body.fixtureDir) args.push('--fixture-dir', String(body.fixtureDir));

      const result = await runPythonModule('src.nhpr_scraper', args);
      if (result.code !== 0) {
        res.status(500).json({
          error: 'NHPR scrape failed',
          stderr: result.stderr,
          stdout: result.stdout,
        });
        return;
      }
      res.json({
        status: 'ok',
        message: result.stdout.trim() || 'NHPR hospital scrape complete',
      });
    });

    app.post('/api/ingest/nhpr/load', async (_req: Request, res: Response) => {
      const result = await runPythonModule('src.load_nhpr');
      if (result.code !== 0) {
        res.status(500).json({
          error: 'NHPR load failed',
          stderr: result.stderr,
          stdout: result.stdout,
        });
        return;
      }
      res.json({
        status: 'ok',
        message: result.stdout.trim() || 'Loaded NHPR hospitals into bronze.locations_nhpr',
      });
    });

    app.get('/api/ingest/medical-travel/status', async (_req: Request, res: Response) => {
      try {
        const rawPath = path.join(MEDICAL_TRAVEL_DATA_DIR, 'mvt_dataset.json');
        const recordsPath = path.join(MEDICAL_TRAVEL_DATA_DIR, 'locations_medical_travel.json');
        const hasRaw = await fileExists(rawPath);
        const hasRecords = await fileExists(recordsPath);

        let bronzeCount: number | null = null;
        try {
          const { rows } = await appkit.lakebase.query(
            `SELECT COUNT(*)::int AS count
             FROM bronze.locations_medical_travel`,
          );
          bronzeCount = Number(rows[0]?.count ?? 0);
        } catch {
          bronzeCount = null;
        }

        res.json({
          dataDir: MEDICAL_TRAVEL_DATA_DIR,
          sourceUrl:
            'https://huggingface.co/datasets/Dhanush008/india-medical-value-travel-mvp/resolve/main/mvt_dataset.json',
          hasRawDataset: hasRaw,
          hasNormalizedRecords: hasRecords,
          bronzeCount,
          mode: 'huggingface_fetch',
          credentialsOptional: true,
        });
      } catch (err) {
        console.error('medical-travel status failed:', err);
        res.status(500).json({ error: 'Failed to read medical travel ingest status' });
      }
    });

    app.get('/api/ingest/medical-travel/locations', async (req: Request, res: Response) => {
      try {
        const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 500);
        const offset = Math.max(Number(req.query.offset ?? 0), 0);
        const state = typeof req.query.state === 'string' ? req.query.state : null;

        const clauses: string[] = [];
        const params: unknown[] = [];
        if (state) {
          params.push(state);
          clauses.push(`state ILIKE $${params.length}`);
        }
        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

        params.push(limit, offset);
        const { rows } = await appkit.lakebase.query(
          `SELECT
             mvt_id,
             name,
             hospital_chain,
             city,
             state,
             tier,
             international_patient_program,
             specialties,
             countries_served,
             has_ipc,
             accreditation,
             avg_cost_index,
             beds,
             established_year,
             international_patients_annually,
             phone,
             email,
             website_url,
             collected_at
           FROM bronze.locations_medical_travel
           ${where}
           ORDER BY state, name
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );
        res.json({ locations: rows, limit, offset });
      } catch (err) {
        console.error('medical-travel locations query failed:', err);
        res.status(500).json({
          error:
            'bronze.locations_medical_travel is unavailable — run `make med-travel` first.',
        });
      }
    });

    app.post('/api/ingest/medical-travel/load', async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const args: string[] = [];
      if (body.refresh === true) args.push('--refresh');

      const result = await runPythonModule('src.load_med_travel', args);
      if (result.code !== 0) {
        res.status(500).json({
          error: 'Medical travel load failed',
          stderr: result.stderr,
          stdout: result.stdout,
        });
        return;
      }
      res.json({
        status: 'ok',
        message:
          result.stdout.trim() ||
          'Loaded MVT hospitals into bronze.locations_medical_travel',
      });
    });
  });
}
