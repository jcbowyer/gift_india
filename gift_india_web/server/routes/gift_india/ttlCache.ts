/** In-process TTL cache for expensive read-mostly API queries (e.g. geo aggregates). */
export function createTtlCache<T>(ttlMs: number) {
  let entry: { value: T; expiresAt: number } | null = null;

  return {
    async get(fetcher: () => Promise<T>): Promise<T> {
      if (entry && Date.now() < entry.expiresAt) return entry.value;
      const value = await fetcher();
      entry = { value, expiresAt: Date.now() + ttlMs };
      return value;
    },
    invalidate() {
      entry = null;
    },
  };
}

/** Data-quality geo aggregates change only after dbt / ingest — 10 min is safe for demo + browsing. */
export const DATA_QUALITY_GEO_TTL_MS = 10 * 60 * 1000;
