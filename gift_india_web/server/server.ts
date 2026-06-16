import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, genie, lakebase, server } from '@databricks/appkit';
import { Pool } from 'pg';
import compression from 'compression';
import { setupgift_indiaRoutes } from './routes/gift_india/routes';

function resolveLocalDbUrl(): string | undefined {
  // Node's --env-file does not override shell exports. Re-read gift_india_web/.env
  // so a stale GIFT_INDIA_DB_URL on :5432 never beats the file's :5433.
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
  if (existsSync(envPath)) {
    for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.startsWith('GIFT_INDIA_DB_URL=')) continue;
      const val = line.slice('GIFT_INDIA_DB_URL='.length).trim().replace(/^["']|["']$/g, '');
      if (val) return val;
    }
  }
  return process.env.GIFT_INDIA_DB_URL;
}

// ── Database selection ────────────────────────────────────────────────────────
// One serving codebase, two backends:
//
//   * Local development — serve from the local Postgres warehouse (the same
//     `gift_india` database dbt builds, on localhost:5433), pointed at by
//     `GIFT_INDIA_DB_URL`. A plain `pg.Pool` is enough; no Databricks auth.
//   * Deployed (Databricks Apps) — connect to Lakebase through the `lakebase()`
//     plugin's OAuth-refreshing pool. `GIFT_INDIA_DB_URL` is unset there, so the
//     deploy path is the default.
//
// The `lakebase()` plugin requires a Lakebase endpoint + Databricks credentials,
// so it is only loaded when we are NOT pointed at the local warehouse.
const LOCAL_DB_URL = resolveLocalDbUrl();
const useLocalDb = Boolean(LOCAL_DB_URL) && process.env.NODE_ENV !== 'production';

// Minimal query surface the routes need — satisfied by both `pg.Pool` and the
// AppKit Lakebase pool.
interface DbHandle {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const basePlugins = useLocalDb ? [server()] : [lakebase(), server()];
// Genie queries governed gold.* via Databricks API — independent of local Postgres vs Lakebase.
const plugins = process.env.DATABRICKS_GENIE_SPACE_ID ? [...basePlugins, genie()] : basePlugins;

createApp({
  plugins,
  async onPluginsReady(appkit) {
    // gzip every response (incl. static topo assets under client/public and the
    // /api/map/geography JSON). Registered first so it sits ahead of AppKit's
    // express.static / Vite middleware in the chain and wraps their responses.
    appkit.server.extend((app) => app.use(compression()));

    let db: DbHandle;
    if (useLocalDb) {
      // Parse GIFT_INDIA_DB_URL into explicit fields. `pg` merges process.env
      // PGHOST/PGPORT/PGSSLMODE (Lakebase deploy vars in gift_india_web/.env)
      // over a connectionString and would otherwise hit the cloud endpoint or
      // the wrong local port (5432 vs system Postgres on 5433).
      const parsed = new URL(LOCAL_DB_URL!.replace(/^postgresql:/, 'postgres:'));
      const pool = new Pool({
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 5433,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, '').split('?')[0] || 'gift_india',
        ssl: false,
      });
      db = { query: (text, params) => pool.query(text, params) };
      console.log(
        '[trust-desk] serving from local Postgres warehouse (%s:%s/%s)',
        parsed.hostname,
        parsed.port || 5433,
        parsed.pathname.replace(/^\//, '').split('?')[0],
      );
    } else {
      db = (appkit as unknown as { lakebase: DbHandle }).lakebase;
      console.log('[trust-desk] serving from Lakebase');
    }
    await setupgift_indiaRoutes({ lakebase: db, server: appkit.server });
  },
}).catch(console.error);
