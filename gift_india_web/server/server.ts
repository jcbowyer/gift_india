import { createApp, lakebase, server } from '@databricks/appkit';
import { Pool } from 'pg';
import compression from 'compression';
import { setupgift_indiaRoutes } from './routes/gift_india/routes';

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
const LOCAL_DB_URL = process.env.GIFT_INDIA_DB_URL;
const useLocalDb = Boolean(LOCAL_DB_URL) && process.env.NODE_ENV !== 'production';

// Minimal query surface the routes need — satisfied by both `pg.Pool` and the
// AppKit Lakebase pool.
interface DbHandle {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

createApp({
  plugins: useLocalDb ? [server()] : [lakebase(), server()],
  async onPluginsReady(appkit) {
    // gzip every response (incl. the 3 MB india-topo.json static asset and the
    // /api/map/geography JSON). Registered first so it sits ahead of AppKit's
    // express.static / Vite middleware in the chain and wraps their responses.
    appkit.server.extend((app) => app.use(compression()));

    let db: DbHandle;
    if (useLocalDb) {
      // The local warehouse (localhost:5433) speaks plain TCP. `pg` otherwise
      // inherits PGSSLMODE=require / PGHOST from .env (those are for the cloud
      // Lakebase endpoint) and tries SSL against local Postgres, which fails with
      // "self-signed certificate". Force SSL off for the local connection string.
      const pool = new Pool({ connectionString: LOCAL_DB_URL, ssl: false });
      db = { query: (text, params) => pool.query(text, params) };
      console.log('[trust-desk] serving from local Postgres warehouse (GIFT_INDIA_DB_URL)');
    } else {
      db = (appkit as unknown as { lakebase: DbHandle }).lakebase;
      console.log('[trust-desk] serving from Lakebase');
    }
    await setupgift_indiaRoutes({ lakebase: db, server: appkit.server });
  },
}).catch(console.error);
