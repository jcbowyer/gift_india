import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { Topology } from 'topojson-specification';
import {
  Card,
  CardContent,
  Badge,
  Button,
  Skeleton,
  Alert,
  AlertTitle,
  AlertDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
  Slider,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Separator,
} from '@databricks/appkit-ui/react';
import {
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
  ArrowLeft,
  MapPin,
  Building2,
  ExternalLink,
  X,
  Circle,
  Hexagon,
  BarChart3,
} from 'lucide-react';
import {
  api,
  type Capability,
  type MapGeography,
  type StateRating,
  type DistrictRating,
  type RegionRating,
  type FacilityRanking,
  type TrustSignal,
  type CatalogGroup,
  type CatalogMetric,
  type MetricValues,
  formatNumber,
} from '../lib/api';
import { DrilldownMap, type HoverInfo, type MapDisplay } from '../components/DrilldownMap';
import { SIGNAL_COLORS, rampFor, builtinValue, normName, placeMatch, type BuiltinMetric } from '../lib/mapPalette';
import { SignalBadge, TrustScoreDial, EvidenceTally } from '../components/trust';

const SIGNAL_FILTERS: { value: TrustSignal | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'strong', label: 'Strong' },
  { value: 'partial', label: 'Partial' },
  { value: 'weak_suspicious', label: 'Suspicious' },
];

const DEFAULT_METRIC: CatalogMetric = {
  key: 'rating',
  label: 'Region trust rating',
  category: 'Trust & Capacity',
  unit: 'score',
  source: 'builtin',
};

function regionSignal(score: number | null): TrustSignal {
  if (score === null) return 'no_claim';
  if (score >= 0.7) return 'strong';
  if (score >= 0.45) return 'partial';
  return 'weak_suspicious';
}

/** Format a metric value by its unit for the readout. */
function formatMetric(v: number | null, unit: string): string {
  if (v === null || !Number.isFinite(v)) return '—';
  switch (unit) {
    case 'score':
      return (v * 100).toFixed(0);
    case 'percent':
      return `${v.toFixed(1)}%`;
    case 'count':
      return formatNumber(Math.round(v));
    case 'ratio':
      return v.toFixed(0);
    case 'inr':
      return `₹${formatNumber(Math.round(v))}`;
    default:
      return Math.abs(v) >= 100 ? formatNumber(Math.round(v)) : v.toFixed(1);
  }
}

function BreakdownBar({ r }: { r: RegionRating }) {
  const total = Math.max(1, r.strong + r.partial + r.weak);
  const seg = (n: number, color: string, label: string) =>
    n > 0 ? <div style={{ width: `${(n / total) * 100}%`, background: color }} title={`${label}: ${n}`} /> : null;
  return (
    <div className="space-y-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {seg(r.strong, SIGNAL_COLORS.strong, 'Strong')}
        {seg(r.partial, SIGNAL_COLORS.partial, 'Partial')}
        {seg(r.weak, SIGNAL_COLORS.weak_suspicious, 'Suspicious')}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span><span className="font-semibold text-foreground">{r.strong}</span> strong</span>
        <span><span className="font-semibold text-foreground">{r.partial}</span> partial</span>
        <span><span className="font-semibold text-foreground">{r.weak}</span> suspicious</span>
      </div>
    </div>
  );
}

/** Big metric readout (right column header) — value + peer rank, Open Navigator style. */
function MetricReadout({
  regionName,
  scope,
  metric,
  value,
  rank,
  total,
}: {
  regionName: string;
  scope: string;
  metric: CatalogMetric;
  value: number | null;
  rank: number | null;
  total: number;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{regionName}</span>
        {rank !== null && total > 1 && (
          <Badge variant="outline" className="shrink-0 text-[10px]">#{rank} of {total}</Badge>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-4xl font-bold tabular-nums text-foreground">{formatMetric(value, metric.unit)}</span>
        {metric.unit === 'score' && <span className="text-lg text-muted-foreground">/100</span>}
      </div>
      <div className="text-sm font-medium uppercase tracking-tight text-foreground/80">{metric.label}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{scope}</div>
    </div>
  );
}

function RegionCard({ title, sub, rating }: { title: string; sub: string; rating: RegionRating }) {
  const sig = regionSignal(rating.avgScore);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <TrustScoreDial score={rating.avgScore ?? 0} signal={sig} />
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{sub}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {rating.avgScore === null ? 'No claims assessed' : `Region trust ${(rating.avgScore * 100).toFixed(0)} / 100`}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg border bg-card px-2 py-1.5">
            <div className="text-base font-bold tabular-nums">{formatNumber(rating.facilities)}</div>
            <div className="text-[10px] text-muted-foreground">facilities</div>
          </div>
          <div className="rounded-lg border bg-card px-2 py-1.5">
            <div className="text-base font-bold tabular-nums">{formatNumber(rating.claiming)}</div>
            <div className="text-[10px] text-muted-foreground">claim capability</div>
          </div>
        </div>
        <BreakdownBar r={rating} />
      </CardContent>
    </Card>
  );
}

function FacilityCard({ f, onClose }: { f: FacilityRanking; onClose: () => void }) {
  const sig = f.overrideSignal ?? f.trustSignal;
  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <TrustScoreDial score={f.trustScore} signal={sig} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold text-foreground">{f.name}</h3>
              <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <SignalBadge signal={sig} />
              <span className="text-[11px] text-muted-foreground">rank #{f.rank}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {f.district}, {f.state}</span>
          <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {f.type}</span>
          {f.beds !== null && <span>{f.beds} beds</span>}
        </div>
        <p className="text-sm text-foreground/80">{f.summary}</p>
        <EvidenceTally supporting={f.supportingCount} contradicting={f.contradictingCount} />
        <Link to={`/facility/${encodeURIComponent(f.facilityId)}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Full facility record <ExternalLink className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

export function MapPage() {
  const [topology, setTopology] = useState<Topology | null>(null);
  const [topoError, setTopoError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [geo, setGeo] = useState<MapGeography | null>(null);
  const [facilities, setFacilities] = useState<FacilityRanking[]>([]);

  // metric catalog + active metric
  const [groups, setGroups] = useState<CatalogGroup[]>([]);
  const [activeMetric, setActiveMetric] = useState<CatalogMetric>(DEFAULT_METRIC);
  const [metricValues, setMetricValues] = useState<MetricValues | null>(null);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set(['Trust & Capacity']));

  // filters
  const [capability, setCapability] = useState('icu');
  const [signal, setSignal] = useState<TrustSignal | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [minBeds, setMinBeds] = useState(0);

  // map display controls
  const [display, setDisplay] = useState<MapDisplay>('shade');
  const [logScale, setLogScale] = useState(false);

  // drilldown selection
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedFacility, setSelectedFacility] = useState<FacilityRanking | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [hoveredFacilityId, setHoveredFacilityId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/india-topo.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((t: Topology) => setTopology(t))
      .catch(() => setTopoError('Could not load the India map topology.'));
    api.capabilities().then(setCapabilities).catch(() => undefined);
    api.metricCatalog().then((c) => setGroups(c.groups)).catch(() => setGroups([]));
  }, []);

  useEffect(() => {
    api.mapGeography(capability).then(setGeo).catch(() => setGeo(null));
  }, [capability]);

  // store-metric district values (built-in metrics need no fetch; stale values
  // for a different metric are ignored by the `store` memo's key guard below)
  useEffect(() => {
    if (activeMetric.source !== 'store') return;
    let cancelled = false;
    api.metricValues(activeMetric.key).then((v) => !cancelled && setMetricValues(v)).catch(() => !cancelled && setMetricValues(null));
    return () => {
      cancelled = true;
    };
  }, [activeMetric]);

  useEffect(() => {
    api
      .facilities({
        capability,
        state: selectedState ?? undefined,
        district: selectedDistrict ?? undefined,
        signal: signal === 'all' ? undefined : signal,
        limit: 120,
      })
      .then((res) => setFacilities(res.results))
      .catch(() => setFacilities([]));
  }, [capability, selectedState, selectedDistrict, signal]);

  const stateRatings: StateRating[] = useMemo(() => geo?.states ?? [], [geo]);
  const districtRatings: DistrictRating[] = useMemo(() => geo?.districts ?? [], [geo]);

  const facilityTypes = useMemo(() => Array.from(new Set(facilities.map((f) => f.type))).sort(), [facilities]);
  const filteredFacilities = useMemo(
    () => facilities.filter((f) => (typeFilter === 'all' || f.type === typeFilter) && (f.beds ?? 0) >= minBeds),
    [facilities, typeFilter, minBeds],
  );

  const level = selectedDistrict ? 'district' : selectedState ? 'state' : 'nation';
  const activeFilters = (signal !== 'all' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0) + (minBeds > 0 ? 1 : 0);
  const { ramp, isRate } = rampFor(activeMetric.source, activeMetric.key);
  const logDisabled = isRate;
  const effectiveLog = logScale && !logDisabled;

  // store metric → state averages, per-state district list, national mean
  const store = useMemo(() => {
    if (activeMetric.source !== 'store' || !metricValues || metricValues.key !== activeMetric.key) return null;
    const byStateDist = new Map<string, { district: string; value: number }[]>();
    const all: number[] = [];
    for (const row of metricValues.districts) {
      const sn = normName(row.state);
      (byStateDist.get(sn) ?? byStateDist.set(sn, []).get(sn)!).push({ district: row.district, value: row.value });
      all.push(row.value);
    }
    const stateAvg = new Map<string, number>();
    for (const [sn, arr] of byStateDist) stateAvg.set(sn, arr.reduce((a, b) => a + b.value, 0) / arr.length);
    const national = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
    return { byStateDist, stateAvg, national };
  }, [activeMetric, metricValues]);

  const valueOfState = useCallback(
    (s: StateRating): number | null => {
      if (activeMetric.source === 'builtin') return builtinValue(s, activeMetric.key as BuiltinMetric);
      return store?.stateAvg.get(normName(s.state)) ?? null;
    },
    [activeMetric, store],
  );
  const valueOfDistrict = useCallback(
    (d: DistrictRating): number | null => {
      if (activeMetric.source === 'builtin') return builtinValue(d, activeMetric.key as BuiltinMetric);
      const arr = store?.byStateDist.get(normName(d.state));
      return arr?.find((x) => placeMatch(x.district, d.district))?.value ?? null;
    },
    [activeMetric, store],
  );

  const national: RegionRating = useMemo(() => {
    const acc = { facilities: 0, claiming: 0, strong: 0, partial: 0, weak: 0, scoreSum: 0 };
    for (const s of stateRatings) {
      acc.facilities += s.facilities;
      acc.claiming += s.claiming;
      acc.strong += s.strong;
      acc.partial += s.partial;
      acc.weak += s.weak;
      if (s.avgScore !== null) acc.scoreSum += s.avgScore * s.claiming;
    }
    return {
      facilities: acc.facilities,
      claiming: acc.claiming,
      strong: acc.strong,
      partial: acc.partial,
      weak: acc.weak,
      avgScore: acc.claiming > 0 ? acc.scoreSum / acc.claiming : null,
    };
  }, [stateRatings]);

  const selStateRating = useMemo(() => stateRatings.find((s) => s.state === selectedState) ?? null, [stateRatings, selectedState]);
  const selDistrictRating = useMemo(
    () => districtRatings.find((d) => d.state === selectedState && d.district === selectedDistrict) ?? null,
    [districtRatings, selectedState, selectedDistrict],
  );

  // colour-gradient domain for the legend — the actual min/max the map shades
  // across (states at nation level, the focused state's districts at state level).
  // Rate metrics use a fixed 0–1 domain; everything else uses the data extent.
  const legendDomain = useMemo<[number, number] | null>(() => {
    if (isRate) return [0, 1];
    const vals =
      level === 'state'
        ? districtRatings.filter((d) => d.state === selectedState).map(valueOfDistrict)
        : stateRatings.map(valueOfState);
    const nums = vals.filter((v): v is number => v !== null && Number.isFinite(v));
    if (!nums.length) return null;
    return [Math.min(...nums), Math.max(...nums)];
  }, [isRate, level, selectedState, stateRatings, districtRatings, valueOfState, valueOfDistrict]);

  // active-metric value + peer rank for the focused (or hovered) region
  const readout = useMemo(() => {
    const hoverRating = hover && (hover.kind === 'state' || hover.kind === 'district') ? hover.rating ?? null : null;

    if ((hover?.kind === 'district' && hoverRating) || level === 'district') {
      const dr = (hoverRating as DistrictRating) ?? selDistrictRating;
      if (dr) {
        const peers = districtRatings.filter((d) => d.state === dr.state).map(valueOfDistrict).filter((v): v is number => v !== null);
        const v = valueOfDistrict(dr);
        const rank = v === null ? null : peers.filter((p) => p > v).length + 1;
        return { name: dr.district, scope: `District · ${dr.state}`, value: v, rank, total: peers.length };
      }
    }
    if ((hover?.kind === 'state' && hoverRating) || level === 'state') {
      const sr = (hoverRating as StateRating) ?? selStateRating;
      if (sr) {
        const peers = stateRatings.map(valueOfState).filter((v): v is number => v !== null);
        const v = valueOfState(sr);
        const rank = v === null ? null : peers.filter((p) => p > v).length + 1;
        return { name: sr.state, scope: 'State', value: v, rank, total: peers.length };
      }
    }
    // nation
    const v = activeMetric.source === 'builtin' ? builtinValue(national, activeMetric.key as BuiltinMetric) : store?.national ?? null;
    return { name: 'India', scope: 'All states', value: v, rank: null, total: 0 };
  }, [hover, level, selDistrictRating, selStateRating, districtRatings, stateRatings, valueOfState, valueOfDistrict, activeMetric, national, store]);

  const drillTo = {
    state: (s: string | null) => { setSelectedState(s); setSelectedDistrict(null); setSelectedFacility(null); },
    district: (d: string | null) => { setSelectedDistrict(d); setSelectedFacility(null); },
    nation: () => { setSelectedState(null); setSelectedDistrict(null); setSelectedFacility(null); },
  };
  const toggleCat = (c: string) =>
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const activeCap = capabilities.find((c) => c.key === capability);

  return (
    <div className="mx-auto flex h-[calc(100vh-9.5rem)] max-w-[1500px] flex-col gap-3">
      {/* breadcrumb + title + capability pills */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-sm">
          {level !== 'nation' && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => (selectedDistrict ? drillTo.state(selectedState) : drillTo.nation())}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          )}
          <button className="font-medium text-muted-foreground hover:text-foreground" onClick={drillTo.nation}>India</button>
          {selectedState && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <button className="font-medium text-muted-foreground hover:text-foreground" onClick={() => drillTo.state(selectedState)}>{selectedState}</button>
            </>
          )}
          {selectedDistrict && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-semibold text-foreground">{selectedDistrict}</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {capabilities.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCapability(c.key)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                capability === c.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {topoError && (
        <Alert variant="destructive">
          <AlertTitle>Map unavailable</AlertTitle>
          <AlertDescription>{topoError}</AlertDescription>
        </Alert>
      )}

      {/* LEFT metrics catalog · CENTER map · RIGHT readout */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[250px_1fr_330px]">
        {/* metrics catalog */}
        <aside className="flex min-h-0 flex-col rounded-xl border bg-card">
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Metrics</span>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-2">
              {groups.length === 0 ? (
                <div className="space-y-1 p-1">
                  {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-7 w-full rounded" />)}
                </div>
              ) : (
                groups.map((g) => {
                  const open = openCats.has(g.category);
                  return (
                    <div key={g.category} className="mb-1">
                      <button
                        type="button"
                        onClick={() => toggleCat(g.category)}
                        className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/50"
                      >
                        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        <span className="flex-1">{g.category}</span>
                        <span className="text-[10px] font-normal text-muted-foreground/70">{g.metrics.length}</span>
                      </button>
                      {open && (
                        <div className="mt-0.5 space-y-0.5">
                          {g.metrics.map((m) => {
                            const isActive = activeMetric.source === m.source && activeMetric.key === m.key;
                            return (
                              <button
                                key={`${m.source}-${m.key}`}
                                type="button"
                                onClick={() => setActiveMetric(m)}
                                className={`block w-full rounded-md px-2 py-1.5 pl-7 text-left text-[13px] transition-colors ${
                                  isActive ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                                }`}
                              >
                                {m.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* map + controls */}
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Display</span>
              <ToggleGroup type="single" value={display} onValueChange={(v) => v && setDisplay(v as MapDisplay)} variant="outline" size="sm">
                <ToggleGroupItem value="shade" className="gap-1 text-xs"><Hexagon className="h-3.5 w-3.5" /> Shade</ToggleGroupItem>
                <ToggleGroupItem value="bubble" className="gap-1 text-xs"><Circle className="h-3.5 w-3.5" /> Bubble</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Scale</span>
              <ToggleGroup
                type="single"
                value={effectiveLog ? 'log' : 'linear'}
                onValueChange={(v) => v && setLogScale(v === 'log')}
                variant="outline"
                size="sm"
                disabled={logDisabled}
              >
                <ToggleGroupItem value="linear" className="text-xs">Linear</ToggleGroupItem>
                <ToggleGroupItem value="log" className="text-xs">Log</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="ml-auto gap-1.5">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filters
                  {activeFilters > 0 && <Badge className="ml-1 h-5 min-w-5 justify-center px-1 text-[10px]">{activeFilters}</Badge>}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-4">
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trust signal</span>
                  <ToggleGroup type="single" value={signal} onValueChange={(v) => v && setSignal(v as TrustSignal | 'all')} variant="outline" className="flex-wrap justify-start">
                    {SIGNAL_FILTERS.map((s) => <ToggleGroupItem key={s.value} value={s.value} className="text-xs">{s.label}</ToggleGroupItem>)}
                  </ToggleGroup>
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Facility type</span>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {facilityTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Min beds</span>
                    <span className="text-xs font-medium tabular-nums text-foreground">{minBeds}+</span>
                  </div>
                  <Slider value={[minBeds]} onValueChange={(v) => setMinBeds(v[0])} min={0} max={1000} step={20} />
                </div>
                <Separator />
                <Button variant="ghost" size="sm" className="w-full" onClick={() => { setSignal('all'); setTypeFilter('all'); setMinBeds(0); }}>Reset filters</Button>
              </PopoverContent>
            </Popover>
          </div>

          <div className="relative min-h-[340px] flex-1">
            {topology ? (
              <DrilldownMap
                topology={topology}
                stateRatings={stateRatings}
                districtRatings={districtRatings}
                facilities={filteredFacilities}
                selectedState={selectedState}
                selectedDistrict={selectedDistrict}
                hoveredFacilityId={hoveredFacilityId}
                selectedFacilityId={selectedFacility?.facilityId ?? null}
                display={display}
                logScale={effectiveLog}
                ramp={ramp}
                isRate={isRate}
                valueOfState={valueOfState}
                valueOfDistrict={valueOfDistrict}
                onSelectState={drillTo.state}
                onSelectDistrict={drillTo.district}
                onSelectFacility={setSelectedFacility}
                onHover={setHover}
              />
            ) : (
              !topoError && <Skeleton className="h-full w-full rounded-xl" />
            )}
            {/* legend */}
            <div className="pointer-events-none absolute left-2 top-2 space-y-1 rounded-lg bg-white/85 px-2.5 py-2 text-[10px] shadow-sm">
              <div className="font-semibold text-slate-600">
                {level === 'district' ? 'Facility trust' : `${activeMetric.label}${effectiveLog ? ' · log' : ''}`}
              </div>
              {level === 'district' ? (
                <div className="flex flex-col gap-0.5">
                  {(['strong', 'partial', 'weak_suspicious'] as TrustSignal[]).map((s) => (
                    <span key={s} className="flex items-center gap-1.5 text-slate-600">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: SIGNAL_COLORS[s] }} />
                      {s === 'weak_suspicious' ? 'suspicious' : s}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="min-w-[1.5rem] text-right tabular-nums font-medium text-slate-600">
                    {legendDomain ? formatMetric(legendDomain[0], activeMetric.unit) : 'low'}
                  </span>
                  <span className="h-2 w-20 rounded-full" style={{ background: `linear-gradient(to right, ${ramp.join(', ')})` }} />
                  <span className="min-w-[1.5rem] tabular-nums font-medium text-slate-600">
                    {legendDomain ? formatMetric(legendDomain[1], activeMetric.unit) : 'high'}
                  </span>
                </div>
              )}
              {level !== 'district' && (
                <div className="text-slate-400">
                  {display === 'bubble' ? 'size = facility count' : 'colour by region'}
                  {activeMetric.unit !== 'score' && activeMetric.unit !== 'count' && ` · ${activeMetric.unit}`}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* readout + scorecard */}
        <aside className="flex min-h-0 flex-col">
          <ScrollArea className="min-h-0 flex-1 pr-2">
            <div className="space-y-3">
              <MetricReadout regionName={readout.name} scope={readout.scope} metric={activeMetric} value={readout.value} rank={readout.rank} total={readout.total} />

              {selectedFacility ? (
                <FacilityCard f={selectedFacility} onClose={() => setSelectedFacility(null)} />
              ) : hover?.kind === 'facility' && hover.facility ? (
                <FacilityCard f={hover.facility} onClose={() => setHover(null)} />
              ) : level === 'district' && selDistrictRating ? (
                <RegionCard title={selectedDistrict!} sub={`District · ${selectedState}`} rating={selDistrictRating} />
              ) : level === 'state' && selStateRating ? (
                <RegionCard title={selectedState!} sub="State" rating={selStateRating} />
              ) : (
                <RegionCard title="India" sub={`All states · ${activeCap?.label ?? capability}`} rating={national} />
              )}

              <div className="flex items-center justify-between px-0.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Top facilities {level !== 'nation' && `· ${selectedDistrict ?? selectedState}`}
                </span>
                <Badge variant="outline" className="text-[10px]">{filteredFacilities.length}</Badge>
              </div>

              {filteredFacilities.length === 0 ? (
                <p className="px-0.5 text-xs text-muted-foreground">No facilities claim {activeCap?.label ?? 'this capability'} for the current scope and filters.</p>
              ) : (
                <div className="space-y-1.5">
                  {filteredFacilities.slice(0, 60).map((f) => {
                    const sig = f.overrideSignal ?? f.trustSignal;
                    const isSel = selectedFacility?.facilityId === f.facilityId;
                    return (
                      <button
                        key={f.facilityId}
                        type="button"
                        onMouseEnter={() => setHoveredFacilityId(f.facilityId)}
                        onMouseLeave={() => setHoveredFacilityId(null)}
                        onClick={() => setSelectedFacility(f)}
                        className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                          isSel ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50'
                        }`}
                      >
                        <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">#{f.rank}</span>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SIGNAL_COLORS[sig] }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{f.name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{f.district} · {f.type}</span>
                        </span>
                        <span className="text-xs font-bold tabular-nums text-foreground">{Math.round(f.trustScore * 100)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
