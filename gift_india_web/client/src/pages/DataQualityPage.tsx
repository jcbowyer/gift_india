import { useState, useEffect, useMemo, Fragment } from 'react';
import { api } from '../lib/api';
import { GeographyCoverageMap } from '../components/GeographyCoverageMap';
import type {
  DataQualityReport,
  DataQualityMissingFacility,
  DataQualityUnmappedDistrict,
  DataQualityGeographyStateRow,
} from '../lib/api';

type SortKey = 'state' | 'total' | 'withUrl' | 'pct' | 'missing';
type GeoSortKey = 'state' | 'totalDistricts' | 'mappedDistricts' | 'pct' | 'facilities';
type SortDir = 'asc' | 'desc';
type TabId = 'state' | 'type' | 'geography';

function coverageBarColor(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500';
  if (pct >= 50) return 'bg-blue-500';
  if (pct >= 25) return 'bg-amber-500';
  return 'bg-red-500';
}

function coverageTextColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-700';
  if (pct >= 50) return 'text-blue-700';
  if (pct >= 25) return 'text-amber-700';
  return 'text-red-700';
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="gift-elevate rounded-xl border bg-card p-4 flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-2xl font-bold text-foreground tabular-nums">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

function CoverageBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${coverageBarColor(pct)}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className={`text-xs font-mono font-semibold tabular-nums w-14 text-right ${coverageTextColor(pct)}`}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="ml-1 text-muted-foreground/40">↕</span>;
  return <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>;
}

export function DataQualityPage() {
  const [data, setData] = useState<DataQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [drillState, setDrillState] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<DataQualityMissingFacility[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('state');
  const [geoSortKey, setGeoSortKey] = useState<GeoSortKey>('pct');
  const [geoSortDir, setGeoSortDir] = useState<SortDir>('asc');
  const [geoDrillState, setGeoDrillState] = useState<string | null>(null);
  const [geoDrillData, setGeoDrillData] = useState<DataQualityUnmappedDistrict[] | null>(null);
  const [geoDrillLoading, setGeoDrillLoading] = useState(false);

  useEffect(() => {
    api
      .dataQuality()
      .then(setData)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const sortedStates = useMemo(() => {
    if (!data) return [];
    return [...data.byState].sort((a, b) => {
      let diff = 0;
      if (sortKey === 'state') diff = a.state.localeCompare(b.state);
      else if (sortKey === 'total') diff = a.total - b.total;
      else if (sortKey === 'withUrl') diff = a.withUrl - b.withUrl;
      else if (sortKey === 'pct') diff = a.pct - b.pct;
      else if (sortKey === 'missing') diff = a.missing - b.missing;
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [data, sortKey, sortDir]);

  const sortedGeoStates = useMemo(() => {
    if (!data) return [];
    return [...data.byGeography.byState].sort((a, b) => {
      let diff = 0;
      if (geoSortKey === 'state') diff = a.state.localeCompare(b.state);
      else if (geoSortKey === 'totalDistricts') diff = a.totalDistricts - b.totalDistricts;
      else if (geoSortKey === 'mappedDistricts') diff = a.mappedDistricts - b.mappedDistricts;
      else if (geoSortKey === 'pct') diff = a.pct - b.pct;
      else if (geoSortKey === 'facilities') diff = a.facilities - b.facilities;
      return geoSortDir === 'asc' ? diff : -diff;
    });
  }, [data, geoSortKey, geoSortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function toggleGeoSort(key: GeoSortKey) {
    if (geoSortKey === key) setGeoSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setGeoSortKey(key);
      setGeoSortDir(key === 'state' ? 'asc' : 'desc');
    }
  }

  async function toggleGeoDrill(state: string, unmappedCount: number) {
    if (unmappedCount <= 0) return;
    if (geoDrillState === state) {
      setGeoDrillState(null);
      setGeoDrillData(null);
      return;
    }
    setGeoDrillState(state);
    setGeoDrillData(null);
    setGeoDrillLoading(true);
    try {
      const rows = await api.dataQualityUnmappedDistricts(state);
      setGeoDrillData(rows);
    } finally {
      setGeoDrillLoading(false);
    }
  }

  async function toggleDrill(state: string) {
    if (drillState === state) {
      setDrillState(null);
      setDrillData(null);
      return;
    }
    setDrillState(state);
    setDrillData(null);
    setDrillLoading(true);
    try {
      const rows = await api.dataQualityMissing(state);
      setDrillData(rows);
    } finally {
      setDrillLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading data quality metrics…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive text-sm">
        {error ?? 'Failed to load data'}
      </div>
    );
  }

  const { summary } = data;

  const stateCols: [SortKey, string][] = [
    ['state',   'State'],
    ['total',   'Total'],
    ['withUrl', 'With URL'],
    ['pct',     'Coverage'],
    ['missing', 'Missing'],
  ];

  const geoStateCols: [GeoSortKey, string][] = [
    ['state',           'State'],
    ['totalDistricts',  'Districts'],
    ['mappedDistricts', 'Mapped'],
    ['pct',             'Map rate'],
    ['facilities',      'Facilities'],
  ];

  const tabLabels: Record<TabId, string> = {
    state: 'By State',
    type: 'By Facility Type',
    geography: 'Map Coverage',
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6" data-demo="data-quality">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Data Quality</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Web address coverage — tracks which facilities have a known website URL and whether that site was successfully
          scraped. Computed from{' '}
          <code className="font-mono text-xs bg-muted px-1 rounded">gold.facilities</code> joined
          against{' '}
          <code className="font-mono text-xs bg-muted px-1 rounded">bronze.facility_web_crawl</code>.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-demo="web-address-kpis">
        <KpiCard label="Total Facilities" value={summary.total.toLocaleString()} />
        <KpiCard label="With URL" value={summary.withUrl.toLocaleString()} />
        <KpiCard
          label="URL Coverage"
          value={`${summary.pctWithUrl}%`}
          sub="% with website URL"
        />
        <KpiCard label="Missing URL" value={summary.missing.toLocaleString()} />
        <KpiCard
          label="Scraped"
          value={summary.scrapeTotal.toLocaleString()}
          sub="crawl attempts"
        />
        <KpiCard
          label="Scrape Success"
          value={`${summary.scrapePct}%`}
          sub={`${summary.scrapeOk.toLocaleString()} ok`}
        />
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 border-b pb-0">
        {(['state', 'type', 'geography'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {/* State breakdown */}
      {activeTab === 'state' && (
        <div className="gift-elevate rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-foreground">Coverage by State</h2>
            <span className="text-xs text-muted-foreground">
              Click a row with missing facilities to see them
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  {stateCols.map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap ${
                        key === 'state' ? 'text-left' : key === 'pct' ? 'text-left' : 'text-right'
                      }`}
                    >
                      {label}
                      <SortIcon active={sortKey === key} dir={sortDir} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedStates.map((row) => (
                  <Fragment key={row.state}>
                    <tr
                      onClick={() => row.missing > 0 && toggleDrill(row.state)}
                      className={`border-b transition-colors ${
                        row.missing > 0 ? 'cursor-pointer hover:bg-muted/40' : ''
                      } ${drillState === row.state ? 'bg-muted/20' : ''}`}
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">
                        <span className="flex items-center gap-1.5">
                          {row.state}
                          {row.missing > 0 && (
                            <span className="text-muted-foreground text-xs leading-none">
                              {drillState === row.state ? '▲' : '▼'}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-right">
                        {row.total.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-right">
                        {row.withUrl.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 min-w-[180px]">
                        <CoverageBar pct={row.pct} />
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-right">
                        {row.missing > 0 ? (
                          <span className="text-red-600 font-medium">
                            {row.missing.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-emerald-600">—</span>
                        )}
                      </td>
                    </tr>

                    {drillState === row.state && (
                      <tr>
                        <td colSpan={5} className="px-4 py-0 bg-muted/10">
                          <div className="py-3">
                            {drillLoading ? (
                              <p className="text-xs text-muted-foreground py-2">Loading…</p>
                            ) : drillData && drillData.length > 0 ? (
                              <div className="rounded-lg border overflow-hidden" data-demo="missing-finder">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b bg-muted/60">
                                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                                        Facility
                                      </th>
                                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                                        Type
                                      </th>
                                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                                        District
                                      </th>
                                      <th className="px-3 py-2 text-right font-semibold text-muted-foreground">
                                        Beds
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {drillData.map((f) => (
                                      <tr
                                        key={f.facilityId}
                                        className="border-b last:border-0 hover:bg-muted/40"
                                      >
                                        <td className="px-3 py-1.5 font-medium">{f.name}</td>
                                        <td className="px-3 py-1.5 text-muted-foreground">
                                          {f.type ?? '—'}
                                        </td>
                                        <td className="px-3 py-1.5 text-muted-foreground">
                                          {f.district}
                                        </td>
                                        <td className="px-3 py-1.5 text-right tabular-nums">
                                          {f.beds != null ? f.beds.toLocaleString() : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {drillData.length >= 500 && (
                                  <p className="px-3 py-2 text-xs text-muted-foreground border-t">
                                    Showing first 500
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground py-2">
                                No missing facilities found.
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Geography map coverage */}
      {activeTab === 'geography' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Map rate — share of reference geography units with at least one facility in{' '}
            <code className="font-mono text-xs bg-muted px-1 rounded">gold.facilities</code>, matched
            against{' '}
            <code className="font-mono text-xs bg-muted px-1 rounded">gold.geography</code> at each
            administrative level (Survey of India Levels 1–3).
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Overall map rate"
              value={`${data.byGeography.overall.pct}%`}
              sub={`${data.byGeography.overall.mapped.toLocaleString()} / ${data.byGeography.overall.total.toLocaleString()} districts`}
            />
            <KpiCard
              label="Facilities linked"
              value={`${data.byGeography.overall.facilityPct}%`}
              sub={`${data.byGeography.overall.withGeography.toLocaleString()} with geography_id`}
            />
            {data.byGeography.levels.map((level) => (
              <KpiCard
                key={level.level}
                value={`${level.pct}%`}
                label={level.label}
                sub={
                  level.level === 'nation'
                    ? level.mapped > 0
                      ? 'India has facility data'
                      : 'No facility data'
                    : `${level.mapped.toLocaleString()} / ${level.total.toLocaleString()} units mapped`
                }
              />
            ))}
          </div>

          <GeographyCoverageMap byState={data.byGeography.byState} />

          <div className="gift-elevate rounded-xl border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-foreground">Map rate by State</h2>
              <span className="text-xs text-muted-foreground">
                Facility geography linkage by state · click gaps to expand
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    {geoStateCols.map(([key, label]) => (
                      <th
                        key={key}
                        onClick={() => toggleGeoSort(key)}
                        className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap ${
                          key === 'state' || key === 'pct' ? 'text-left' : 'text-right'
                        }`}
                      >
                        {label}
                        <SortIcon active={geoSortKey === key} dir={geoSortDir} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedGeoStates.map((row) => {
                    const unmapped = row.totalDistricts - row.mappedDistricts;
                    return (
                      <GeoStateRow
                        key={row.state}
                        row={row}
                        unmapped={unmapped}
                        expanded={geoDrillState === row.state}
                        drillLoading={geoDrillLoading}
                        drillData={geoDrillState === row.state ? geoDrillData : null}
                        onToggle={() => toggleGeoDrill(row.state, unmapped)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Type breakdown */}
      {activeTab === 'type' && (
        <div className="gift-elevate rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold text-foreground">Coverage by Facility Type</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Type
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Total
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    With URL
                  </th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[180px]">
                    Coverage
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Missing
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.byType.map((row) => (
                  <tr key={row.type} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{row.type}</td>
                    <td className="px-4 py-2.5 tabular-nums text-right">
                      {row.total.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-right">
                      {row.withUrl.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <CoverageBar pct={row.pct} />
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-right">
                      {row.missing > 0 ? (
                        <span className="text-red-600 font-medium">
                          {row.missing.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-emerald-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
          ≥80% coverage
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-500 shrink-0" />
          50–79%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-amber-500 shrink-0" />
          25–49%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-red-500 shrink-0" />
          &lt;25%
        </span>
      </div>
    </div>
  );
}

function GeoStateRow({
  row,
  unmapped,
  expanded,
  drillLoading,
  drillData,
  onToggle,
}: {
  row: DataQualityGeographyStateRow;
  unmapped: number;
  expanded: boolean;
  drillLoading: boolean;
  drillData: DataQualityUnmappedDistrict[] | null;
  onToggle: () => void;
}) {
  return (
    <Fragment>
      <tr
        onClick={() => unmapped > 0 && onToggle()}
        className={`border-b transition-colors ${
          unmapped > 0 ? 'cursor-pointer hover:bg-muted/40' : ''
        } ${expanded ? 'bg-muted/20' : ''}`}
      >
        <td className="px-4 py-2.5 font-medium text-foreground">
          <span className="flex items-center gap-1.5">
            {row.state}
            {!row.stateMapped && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                No data
              </span>
            )}
            {unmapped > 0 && (
              <span className="text-muted-foreground text-xs leading-none">
                {expanded ? '▲' : '▼'}
              </span>
            )}
          </span>
        </td>
        <td className="px-4 py-2.5 tabular-nums text-right">{row.totalDistricts.toLocaleString()}</td>
        <td className="px-4 py-2.5 tabular-nums text-right">{row.mappedDistricts.toLocaleString()}</td>
        <td className="px-4 py-2.5 min-w-[180px]">
          <CoverageBar pct={row.pct} />
        </td>
        <td className="px-4 py-2.5 tabular-nums text-right">{row.facilities.toLocaleString()}</td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={5} className="px-4 py-0 bg-muted/10">
            <div className="py-3">
              {drillLoading ? (
                <p className="text-xs text-muted-foreground py-2">Loading…</p>
              ) : drillData && drillData.length > 0 ? (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                          Unmapped district
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {drillData.map((d) => (
                        <tr key={d.district} className="border-b last:border-0 hover:bg-muted/40">
                          <td className="px-3 py-1.5 font-medium">{d.district}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-2">All districts mapped.</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
