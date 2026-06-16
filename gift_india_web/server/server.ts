import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, genie, lakebase, server } from '@databricks/appkit';
import { Pool } from 'pg';
import compression from 'compression';
import { setupgift_indiaRoutes } from './routes/gift_india/routes';

function readEnvVars(envPath: string): Map<string, string> {
  const vars = new Map<string, string>();
  if (!existsSync(envPath)) return vars;
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    vars.set(key, val);
  }
  return vars;
}

function buildDbUrlFromParts(vars: Map<string, string>): string | undefined {
  const host = vars.get('GIFT_INDIA_PGHOST');
  const port = vars.get('GIFT_INDIA_PGPORT');
  const user = vars.get('GIFT_INDIA_PGUSER');
  const password = vars.get('GIFT_INDIA_PGPASSWORD');
  const database = vars.get('GIFT_INDIA_PGDATABASE');
  if (!host && !port && !user && !database) return undefined;
  const h = host || 'localhost';
  const p = port || '5433';
  const u = user || 'postgres';
  const d = database || 'gift_india';
  const auth = password
    ? `${encodeURIComponent(u)}:${encodeURIComponent(password)}`
    : encodeURIComponent(u);
  return `postgresql://${auth}@${h}:${p}/${d}`;
}

function resolveLocalDbUrl(): string | undefined {
  // Node's --env-file does not override shell exports. Re-read repo .env files so a
  // stale GIFT_INDIA_DB_URL on :5432 never beats the configured :5433 warehouse.
  const webEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
  const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
  const merged = new Map<string, string>();
  for (const envPath of [rootEnvPath, webEnvPath]) {
    for (const [key, val] of readEnvVars(envPath)) merged.set(key, val);
  }

  const explicitUrl = merged.get('GIFT_INDIA_DB_URL');
  if (explicitUrl) return explicitUrl;

  const fromParts = buildDbUrlFromParts(merged);
  if (fromParts) return fromParts;

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

function lakebaseHandle(appkit: { lakebase?: DbHandle }): DbHandle {
  if (!appkit.lakebase) {
    throw new Error('Lakebase plugin is not registered — unset GIFT_INDIA_DB_URL for deploy.');
  }
  return appkit.lakebase;
}

const basePlugins = useLocalDb ? [server()] : [lakebase(), server()];
const giftGenieSpaceId =
  process.env.DATABRICKS_GIFT_GENIE_SPACE_ID ?? process.env.DATABRICKS_GENIE_SPACE_ID;
const plugins = giftGenieSpaceId
  ? [...basePlugins, genie({ spaces: { gift: giftGenieSpaceId } })]
  : basePlugins;

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
      db = lakebaseHandle(appkit);
      console.log('[trust-desk] serving from Lakebase');
    }
    await setupgift_indiaRoutes({ lakebase: db, server: appkit.server });
  },
}).catch(console.error);
