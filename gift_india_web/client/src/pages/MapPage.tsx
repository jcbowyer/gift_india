import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
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
  SlidersHorizontal,
  ArrowLeft,
  MapPin,
  Building2,
  ExternalLink,
  X,
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
import { MapToolRail, type MapFlyoutId } from '../components/MapToolRail';
import { MapLegend } from '../components/MapLegend';
import { MapLoadingOverlay } from '../components/MapLoadingOverlay';
import { SIGNAL_COLORS, rampFor, builtinValue, normName, placeMatch, type BuiltinMetric } from '../lib/mapPalette';
import { SignalBadge, TrustScoreDial, EvidenceTally, BestSourceBadge } from '../components/trust';

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

const REGION_FILTERS = ['North', 'Central', 'East', 'West', 'South', 'North-East'] as const;

// Shown for a district drilled straight from its boundary that has no surveyed
// facilities — so the panel still names the place instead of falling back to state.
const EMPTY_RATING: RegionRating = { facilities: 0, claiming: 0, avgScore: null, strong: 0, partial: 0, weak: 0 };

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
}: {
  regionName: string;
  scope: string;
  metric: CatalogMetric;
  value: number | null;
}) {
  return (
    <div className="gift-elevate rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-base font-semibold uppercase tracking-wide text-foreground">{regionName}</span>
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
    <Card className="gift-lift gift-fade-in">
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
    <Card className="border-primary/40 gift-lift gift-fade-in">
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
        </div>
        {f.beds !== null && (
          <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
            <Building2 className="h-3.5 w-3.5" /> Impact: {f.beds} beds serving {f.district}
          </div>
        )}
        <p className="text-sm text-foreground/80">{f.summary}</p>
        <EvidenceTally supporting={f.supportingCount} contradicting={f.contradictingCount} />
        {f.bestSource && <BestSourceBadge source={f.bestSource} />}
        <Link to={`/facility/${encodeURIComponent(f.facilityId)}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Full facility record <ExternalLink className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

export function MapPage() {
  const [topology, setTopology] = useState<Topology | null>(null);
  const [worldTopology, setWorldTopology] = useState<Topology | null>(null);
  const [topoError, setTopoError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [geo, setGeo] = useState<MapGeography | null>(null);
  const [facilities, setFacilities] = useState<FacilityRanking[]>([]);

  // metric catalog + active metric
  const [groups, setGroups] = useState<CatalogGroup[]>([]);
  const [activeMetric, setActiveMetric] = useState<CatalogMetric>(DEFAULT_METRIC);
  const [metricValues, setMetricValues] = useState<MetricValues | null>(null);

  // filters
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [capability, setCapability] = useState('icu');
  const [signal, setSignal] = useState<TrustSignal | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [minBeds, setMinBeds] = useState(0);
  const [minTrustScore, setMinTrustScore] = useState(0);

  // map display controls
  const [display, setDisplay] = useState<MapDisplay>('shade');
  const [logScale, setLogScale] = useState(false);
  const [mapFlyout, setMapFlyout] = useState<MapFlyoutId | null>(null);
  const [showPins, setShowPins] = useState(true);

  // drilldown selection
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedFacility, setSelectedFacility] = useState<FacilityRanking | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [hoveredFacilityId, setHoveredFacilityId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const topoLoading = !topology && !topoError;
  const geoLoading = topology !== null && geo === null;
  const mapPreparing = topology !== null && geo !== null && !mapReady;
  const loadingMessage = topoLoading
    ? 'Loading map geography…'
    : geoLoading
      ? 'Loading ratings…'
      : 'Rendering map…';

  // Deep-link drilldown: /navigator?state=…&district=… (e.g. from the landing
  // page's "analysed in depth" list). Captured once at mount — the query carries
  // descriptive labels ("Delhi NCT", "Mumbai City / Suburban") that get resolved
  // to the data's canonical names when geo loads (see the geo effect below).
  const [searchParams, setSearchParams] = useSearchParams();
  const [deepLink] = useState(() => {
    const state = searchParams.get('state');
    const district = searchParams.get('district');
    return state || district ? { state, district } : null;
  });
  const deepLinkApplied = useRef(false);

  useEffect(() => {
    fetch('/india-topo.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((t: Topology) => setTopology(t))
      .catch(() => setTopoError('Could not load the India map topology.'));
    api.capabilities().then(setCapabilities).catch(() => undefined);
    api.metricCatalog().then((c) => setGroups(c.groups)).catch(() => setGroups([]));
  }, []);

  // World backdrop is optional — defer so the India map can paint first.
  useEffect(() => {
    if (!topology) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch('/world-context-topo.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
        .then((t: Topology) => !cancelled && setWorldTopology(t))
        .catch(() => undefined);
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [topology]);

  useEffect(() => {
    setMapReady(false);
  }, [topology, geo, capability, regionFilter, selectedState, selectedDistrict]);

  useEffect(() => {
    let cancelled = false;
    api
      .mapGeography(capability, { region: regionFilter !== 'all' ? regionFilter : undefined })
      .then((g) => {
        if (cancelled) return;
        setGeo(g);
        // Resolve a pending deep-link once the geography is available, matching the
        // descriptive labels against the data's canonical state/district names so
        // the selection uses values the `===` rating lookups + facilities query
        // expect (e.g. "Delhi NCT" → "Delhi", "Mumbai City / Suburban" → "Mumbai").
        if (!deepLink || deepLinkApplied.current) return;
        deepLinkApplied.current = true;
        const matchedState = deepLink.state
          ? g.states.find((s) => placeMatch(s.state, deepLink.state!))?.state ?? null
          : null;
        if (matchedState) {
          setSelectedState(matchedState);
          setSelectedFacility(null);
          setSelectedDistrict(
            deepLink.district
              ? g.districts.find((d) => d.state === matchedState && placeMatch(d.district, deepLink.district!))?.district ?? null
              : null,
          );
        }
        // Drop the params so a later reset/back doesn't re-apply and the URL stays clean.
        setSearchParams({}, { replace: true });
      })
      .catch(() => !cancelled && setGeo(null));
    return () => {
      cancelled = true;
    };
  }, [capability, deepLink, setSearchParams]);

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
    if (!geo) return;
    if (selectedState && !geo.states.some((s) => s.state === selectedState)) {
      setSelectedState(null);
      setSelectedDistrict(null);
      setSelectedFacility(null);
      return;
    }
    if (selectedDistrict && !geo.districts.some((d) => d.state === selectedState && d.district === selectedDistrict)) {
      setSelectedDistrict(null);
      setSelectedFacility(null);
    }
  }, [geo, selectedState, selectedDistrict]);

  useEffect(() => {
    api
      .facilities({
        capability,
        region: regionFilter !== 'all' ? regionFilter : undefined,
        state: selectedState ?? undefined,
        district: selectedDistrict ?? undefined,
        signal: signal === 'all' ? undefined : signal,
        limit: 120,
      })
      .then((res) => setFacilities(res.results))
      .catch(() => setFacilities([]));
  }, [capability, regionFilter, selectedState, selectedDistrict, signal]);

  const stateRatings: StateRating[] = useMemo(() => geo?.states ?? [], [geo]);
  const districtRatings: DistrictRating[] = useMemo(() => geo?.districts ?? [], [geo]);

  const facilityTypes = useMemo(() => Array.from(new Set(facilities.map((f) => f.type))).sort(), [facilities]);
  const filteredFacilities = useMemo(
    () =>
      facilities.filter(
        (f) =>
          (typeFilter === 'all' || f.type === typeFilter) &&
          (f.beds ?? 0) >= minBeds &&
          Math.round(f.trustScore * 100) >= minTrustScore,
      ),
    [facilities, typeFilter, minBeds, minTrustScore],
  );

  const level = selectedDistrict ? 'district' : selectedState ? 'state' : 'nation';
  const activeFilters =
    (regionFilter !== 'all' ? 1 : 0) +
    (signal !== 'all' ? 1 : 0) +
    (typeFilter !== 'all' ? 1 : 0) +
    (minBeds > 0 ? 1 : 0) +
    (minTrustScore > 0 ? 1 : 0);
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

    if (hover?.kind === 'district' || level === 'district') {
      const dr = (hoverRating as DistrictRating) ?? (hover?.kind === 'district' ? null : selDistrictRating);
      if (dr) return { name: dr.district, scope: `District · ${dr.state}`, value: valueOfDistrict(dr) };
      // Data-less district (drilled straight from its boundary): name it, no value.
      const name = hover?.kind === 'district' ? hover.name : selectedDistrict;
      if (name) return { name, scope: selectedState ? `District · ${selectedState}` : 'District', value: null };
    }
    if (hover?.kind === 'state' || level === 'state') {
      const sr = (hoverRating as StateRating) ?? (hover?.kind === 'state' ? null : selStateRating);
      if (sr) return { name: sr.state, scope: 'State', value: valueOfState(sr) };
      const name = hover?.kind === 'state' ? hover.name : selectedState;
      if (name) return { name, scope: 'State', value: null };
    }
    // nation
    const v = activeMetric.source === 'builtin' ? builtinValue(national, activeMetric.key as BuiltinMetric) : store?.national ?? null;
    return { name: 'India', scope: regionFilter === 'all' ? 'All states' : `${regionFilter} region`, value: v };
  }, [hover, level, selectedState, selectedDistrict, selDistrictRating, selStateRating, valueOfState, valueOfDistrict, activeMetric, national, store, regionFilter]);

  const drillTo = {
    state: (s: string | null) => { setSelectedState(s); setSelectedDistrict(null); setSelectedFacility(null); },
    district: (d: string | null) => { setSelectedDistrict(d); setSelectedFacility(null); },
    nation: () => { setSelectedState(null); setSelectedDistrict(null); setSelectedFacility(null); },
  };
  // Step up exactly one drill level (facility → district → state → nation).
  const goBack = () => {
    if (selectedFacility) setSelectedFacility(null);
    else if (selectedDistrict) drillTo.state(selectedState);
    else drillTo.nation();
  };
  const activeCap = capabilities.find((c) => c.key === capability);

  return (
    <div className="mx-auto flex h-[calc(100vh-9.5rem)] max-w-[1500px] flex-col gap-3">
      {/* breadcrumb + title + capability pills */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-sm">
          {(selectedState || selectedFacility) && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={goBack}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          )}
          <button className="font-medium text-muted-foreground hover:text-foreground" onClick={drillTo.nation}>India</button>
          {selectedState && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              {selectedDistrict ? (
                <button className="font-medium text-muted-foreground hover:text-foreground" onClick={() => drillTo.state(selectedState)}>{selectedState}</button>
              ) : (
                <span className="font-semibold text-foreground">{selectedState}</span>
              )}
            </>
          )}
          {selectedDistrict && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              {selectedFacility ? (
                <button className="font-medium text-muted-foreground hover:text-foreground" onClick={() => drillTo.district(selectedDistrict)}>{selectedDistrict}</button>
              ) : (
                <span className="font-semibold text-foreground">{selectedDistrict}</span>
              )}
            </>
          )}
          {selectedFacility && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[16rem] truncate font-semibold text-foreground">{selectedFacility.name}</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {capabilities.map((c) => {
            const active = capability === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCapability(c.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-all ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-card text-muted-foreground hover:-translate-y-px hover:border-primary/40 hover:text-foreground'
                }`}
              >
                {c.label}
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                    active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-primary-foreground' : 'bg-emerald-500'}`} />
                  {c.strong}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {topoError && (
        <Alert variant="destructive">
          <AlertTitle>Map unavailable</AlertTitle>
          <AlertDescription>{topoError}</AlertDescription>
        </Alert>
      )}

      {/* map · right readout */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_330px]">
        {/* map + controls */}
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="ml-auto gap-1.5">
                  <MapPin className="h-4 w-4" />
                  Geography
                  {(regionFilter !== 'all' || selectedState || selectedDistrict) && (
                    <Badge className="ml-1 h-5 min-w-5 justify-center px-1 text-[10px]">
                      {(regionFilter !== 'all' ? 1 : 0) + (selectedState ? 1 : 0) + (selectedDistrict ? 1 : 0)}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-4">
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Region</span>
                  <Select value={regionFilter} onValueChange={setRegionFilter}>
                    <SelectTrigger><SelectValue placeholder="All regions" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All regions</SelectItem>
                      {REGION_FILTERS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">State</span>
                  <Select
                    value={selectedState ?? 'all'}
                    onValueChange={(v) => {
                      if (v === 'all') drillTo.nation();
                      else drillTo.state(v);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="All states" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All states</SelectItem>
                      {stateRatings
                        .slice()
                        .sort((a, b) => a.state.localeCompare(b.state))
                        .map((s) => <SelectItem key={s.state} value={s.state}>{s.state}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">District</span>
                  <Select
                    value={selectedDistrict ?? 'all'}
                    onValueChange={(v) => {
                      if (v === 'all') setSelectedDistrict(null);
                      else drillTo.district(v);
                    }}
                    disabled={!selectedState}
                  >
                    <SelectTrigger><SelectValue placeholder="All districts" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All districts</SelectItem>
                      {districtRatings
                        .filter((d) => d.state === selectedState)
                        .slice()
                        .sort((a, b) => a.district.localeCompare(b.district))
                        .map((d) => <SelectItem key={`${d.state}-${d.district}`} value={d.district}>{d.district}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setRegionFilter('all');
                    drillTo.nation();
                  }}
                >
                  Clear geography
                </Button>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <SlidersHorizontal className="h-4 w-4" />
                  Facility ratings
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
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Min trust score</span>
                    <span className="text-xs font-medium tabular-nums text-foreground">{minTrustScore}</span>
                  </div>
                  <Slider value={[minTrustScore]} onValueChange={(v) => setMinTrustScore(v[0])} min={0} max={100} step={5} />
                </div>
                <Separator />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setRegionFilter('all');
                    setSignal('all');
                    setTypeFilter('all');
                    setMinBeds(0);
                    setMinTrustScore(0);
                  }}
                >
                  Reset filters
                </Button>
              </PopoverContent>
            </Popover>
          </div>

          <div className="relative min-h-[340px] flex-1">
            {topology ? (
              <DrilldownMap
                topology={topology}
                worldTopology={worldTopology}
                stateRatings={stateRatings}
                districtRatings={districtRatings}
                facilities={filteredFacilities}
                selectedState={selectedState}
                selectedDistrict={selectedDistrict}
                hoveredFacilityId={hoveredFacilityId}
                selectedFacilityId={selectedFacility?.facilityId ?? null}
                display={display}
                showPins={showPins}
                logScale={effectiveLog}
                ramp={ramp}
                isRate={isRate}
                valueOfState={valueOfState}
                valueOfDistrict={valueOfDistrict}
                onSelectState={drillTo.state}
                onSelectDistrict={drillTo.district}
                onSelectFacility={setSelectedFacility}
                onHover={setHover}
                onReady={() => setMapReady(true)}
              />
            ) : (
              !topoError && <Skeleton className="h-full w-full rounded-xl" />
            )}
            {(topoLoading || geoLoading || mapPreparing) && !topoError && (
              <MapLoadingOverlay message={loadingMessage} />
            )}
            <MapToolRail
              flyout={mapFlyout}
              onFlyoutChange={setMapFlyout}
              showPins={showPins}
              onShowPinsChange={setShowPins}
              canHome={!!(selectedState || selectedDistrict)}
              onHome={drillTo.nation}
              display={display}
              onDisplayChange={setDisplay}
              logScale={effectiveLog}
              logDisabled={logDisabled}
              onLogScaleChange={setLogScale}
              groups={groups}
              activeMetric={activeMetric}
              onMetricChange={setActiveMetric}
            />

            {/* legend (kept separate so it always fits) */}
            <div className="pointer-events-none absolute bottom-3 left-3 z-10">
              <MapLegend
                level={level}
                activeMetric={activeMetric}
                effectiveLog={effectiveLog}
                display={display}
                ramp={ramp}
                domain={legendDomain}
              />
            </div>
          </div>
        </div>

        {/* readout + scorecard */}
        <aside className="flex min-h-0 flex-col">
          <ScrollArea className="min-h-0 flex-1 pr-2">
            <div className="space-y-3">
              <MetricReadout regionName={readout.name} scope={readout.scope} metric={activeMetric} value={readout.value} />

              {selectedFacility ? (
                <FacilityCard f={selectedFacility} onClose={() => setSelectedFacility(null)} />
              ) : hover?.kind === 'facility' && hover.facility ? (
                <FacilityCard f={hover.facility} onClose={() => setHover(null)} />
              ) : hover?.kind === 'district' && hover.rating ? (
                <RegionCard
                  title={hover.name}
                  sub={`District · ${(hover.rating as DistrictRating).state}`}
                  rating={hover.rating}
                />
              ) : hover?.kind === 'state' && hover.rating ? (
                <RegionCard title={hover.name} sub="State" rating={hover.rating} />
              ) : level === 'district' ? (
                <RegionCard title={selectedDistrict!} sub={`District · ${selectedState}`} rating={selDistrictRating ?? EMPTY_RATING} />
              ) : level === 'state' && selStateRating ? (
                <RegionCard title={selectedState!} sub="State" rating={selStateRating} />
              ) : (
                <RegionCard title="India" sub={`All states · ${activeCap?.label ?? capability}`} rating={national} />
              )}

              <div className="flex items-center justify-between px-0.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Facility rankings {level !== 'nation' && `· ${selectedDistrict ?? selectedState}`}
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
