import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Topology } from 'topojson-specification';
import {
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
  SlidersHorizontal,
  MapPin,
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
  effectiveTrustScore,
  effectiveTrustSignal,
} from '../lib/api';
import { DrilldownMap, type HoverInfo, type MapDisplay } from '../components/DrilldownMap';
import { MapToolRail, type MapFlyoutId } from '../components/MapToolRail';
import { MapLegend } from '../components/MapLegend';
import { MapGeoBreadcrumb } from '../components/MapGeoBreadcrumb';
import { MapFacilitySearch } from '../components/MapFacilitySearch';
import { GeoFilterList } from '../components/GeoFilterList';
import { SIGNAL_COLORS, rampFor, builtinValue, normName, placeMatch, metricExtent, type BuiltinMetric } from '../lib/mapPalette';
import { rollupStateRatings } from '../lib/stateCanonical';
import {
  baseTopoUrl,
  districtTopologySource,
  stateDistrictTopoUrl,
  topologyHasStates,
  zoneTopoHasDistricts,
} from '../lib/mapTopo';
import { useMapViewportInset } from '../lib/useMapViewportInset';
import { MapDrilldownPanel } from '../components/MapDrilldownPanel';

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

type ReadoutGeoLevel = 'nation' | 'state' | 'district' | 'facility';

const GEO_LEVEL_META: Record<
  ReadoutGeoLevel,
  { step: number; label: string; badgeClass: string }
> = {
  nation: { step: 1, label: 'National', badgeClass: 'bg-slate-100 text-slate-700 ring-slate-200' },
  state: { step: 2, label: 'State', badgeClass: 'bg-sky-50 text-sky-800 ring-sky-200' },
  district: { step: 3, label: 'District', badgeClass: 'bg-violet-50 text-violet-800 ring-violet-200' },
  facility: { step: 4, label: 'Facility', badgeClass: 'bg-primary/10 text-primary ring-primary/25' },
};

function GeoLevelBadge({ level }: { level: ReadoutGeoLevel }) {
  const m = GEO_LEVEL_META[level];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${m.badgeClass}`}
    >
      Level {m.step} · {m.label}
    </span>
  );
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

function capabilityPillCount(c: Capability): string {
  return c.claiming.toLocaleString();
}

/** Big metric readout (right column header) — value + peer rank, Open Navigator style. */
function MetricReadout({
  geoLevel,
  regionName,
  scope,
  metric,
  value,
}: {
  geoLevel: ReadoutGeoLevel;
  regionName: string;
  scope: string;
  metric: CatalogMetric;
  value: number | null;
}) {
  const metricLabel = geoLevel === 'facility' ? 'Facility trust rating' : metric.label;
  return (
    <div className="gift-elevate rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <GeoLevelBadge level={geoLevel} />
      </div>
      <div className="mt-2 text-base font-semibold uppercase tracking-wide text-foreground">{regionName}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-4xl font-bold tabular-nums text-foreground">{formatMetric(value, metric.unit)}</span>
        {metric.unit === 'score' && <span className="text-lg text-muted-foreground">/100</span>}
      </div>
      <div className="text-sm font-medium uppercase tracking-tight text-foreground/80">{metricLabel}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{scope}</div>
    </div>
  );
}

export function MapPage() {
  const [baseTopology, setBaseTopology] = useState<Topology | null>(null);
  const [districtTopo, setDistrictTopo] = useState<Topology | null>(null);
  const [districtTopoFailed, setDistrictTopoFailed] = useState(false);
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
  const hoverTimer = useRef<number | null>(null);
  const geoCache = useRef(new Map<string, MapGeography>());
  const facilitiesCache = useRef(new Map<string, FacilityRanking[]>());
  const mapAreaRef = useRef<HTMLDivElement | null>(null);
  const mapRailRef = useRef<HTMLDivElement | null>(null);
  const mapLegendRef = useRef<HTMLDivElement | null>(null);

  const topology = baseTopology;

  const districtTopology = useMemo(
    () => (topology ? districtTopologySource(topology, districtTopo, regionFilter) : null),
    [topology, districtTopo, regionFilter],
  );

  const needsDistrictTopo = Boolean(selectedState && !zoneTopoHasDistricts(regionFilter));
  const districtLayersReady = !needsDistrictTopo || districtTopo !== null || districtTopoFailed;

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
    api.capabilities().then(setCapabilities).catch(() => undefined);
    api.metricCatalog().then((c) => setGroups(c.groups)).catch(() => setGroups([]));
  }, []);

  // Base map: lightweight nation+states, or zone-scoped states+districts.
  useEffect(() => {
    setTopoError(null);
    setBaseTopology(null);
    setDistrictTopo(null);
    let cancelled = false;
    fetch(baseTopoUrl(regionFilter))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((t: Topology) => {
        if (cancelled) return;
        if (!topologyHasStates(t)) {
          setTopoError('Map boundaries are incomplete. Run `npm run build:topo` in gift_india_web.');
          return;
        }
        setBaseTopology(t);
      })
      .catch(() => {
        if (!cancelled) setTopoError('Could not load the India map topology.');
      });
    return () => {
      cancelled = true;
    };
  }, [regionFilter]);

  // All-India view: lazy-load one state's district polygons on drill-down.
  useEffect(() => {
    if (!selectedState || zoneTopoHasDistricts(regionFilter)) {
      setDistrictTopo(null);
      setDistrictTopoFailed(false);
      return;
    }
    let cancelled = false;
    setDistrictTopo(null);
    setDistrictTopoFailed(false);
    fetch(stateDistrictTopoUrl(selectedState))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((t: Topology) => {
        if (!cancelled) setDistrictTopo(t);
      })
      .catch(() => {
        if (!cancelled) {
          setDistrictTopo(null);
          setDistrictTopoFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedState, regionFilter]);

  // World backdrop deferred heavily — optional eye-candy, not worth blocking India map.
  useEffect(() => {
    if (!topology || selectedState) return;
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
  }, [topology, selectedState]);

  useEffect(() => {
    const region = regionFilter !== 'all' ? regionFilter : undefined;
    const nationOnly = !selectedState;
    const cacheKey = `${capability}|${regionFilter}|${selectedState ?? ''}|${nationOnly ? 'nation' : 'state'}`;
    const cached = geoCache.current.get(cacheKey);
    if (cached) {
      setGeo(nationOnly ? { ...cached, districts: [] } : cached);
    } else {
      setGeo(null);
    }

    let cancelled = false;
    api
      .mapGeography(capability, {
        region,
        state: selectedState ?? undefined,
        includeDistricts: !nationOnly,
      })
      .then((g) => {
        if (cancelled) return;
        geoCache.current.set(cacheKey, g);
        setGeo((prev) =>
          nationOnly
            ? { ...g, districts: [] }
            : prev
              ? { ...prev, districts: g.districts }
              : g,
        );
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
        setSearchParams({}, { replace: true });
      })
      .catch(() => {
        if (!cancelled && !cached) setGeo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [capability, regionFilter, selectedState, deepLink, setSearchParams]);

  // Switching capability invalidates facility-level selection and rankings scope.
  useEffect(() => {
    setSelectedFacility(null);
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
    if (!geo) return;
    if (selectedState && !geo.states.some((s) => placeMatch(s.state, selectedState))) {
      setSelectedState(null);
      setSelectedDistrict(null);
      setSelectedFacility(null);
    }
  }, [geo, selectedState]);

  // Align search-picked district names with canonical geography once districts load.
  useEffect(() => {
    if (!geo?.districts.length || !selectedState || !selectedDistrict) return;
    const hit = geo.districts.find(
      (d) => placeMatch(d.state, selectedState) && placeMatch(d.district, selectedDistrict),
    );
    if (!hit) return;
    if (!placeMatch(hit.state, selectedState)) setSelectedState(hit.state);
    if (!placeMatch(hit.district, selectedDistrict)) setSelectedDistrict(hit.district);
  }, [geo, selectedState, selectedDistrict]);

  const selectFacility = useCallback((f: FacilityRanking | null) => {
    if (!f) {
      setSelectedFacility(null);
      return;
    }
    const matchedState = geo?.states.find((s) => placeMatch(s.state, f.state))?.state ?? f.state;
    setSelectedState(matchedState);
    setSelectedDistrict(f.district);
    setSelectedFacility({ ...f, state: matchedState });
    setHoveredFacilityId(f.facilityId);
    setHover({ kind: 'facility', name: f.name, sub: `${f.district}, ${matchedState}`, facility: { ...f, state: matchedState } });
  }, [geo]);

  const handleFacilityUpdated = useCallback((updated: FacilityRanking) => {
    setSelectedFacility((cur) => (cur?.facilityId === updated.facilityId ? updated : cur));
    setFacilities((prev) => prev.map((f) => (f.facilityId === updated.facilityId ? { ...f, ...updated } : f)));
    setHover((h) =>
      h?.kind === 'facility' && h.facility?.facilityId === updated.facilityId
        ? { ...h, facility: { ...h.facility, ...updated } }
        : h,
    );
    const cacheKey = `${capability}|${regionFilter}|${selectedState ?? ''}|${selectedDistrict ?? ''}|${signal}`;
    const cached = facilitiesCache.current.get(cacheKey);
    if (cached) {
      facilitiesCache.current.set(
        cacheKey,
        cached.map((f) => (f.facilityId === updated.facilityId ? { ...f, ...updated } : f)),
      );
    }
  }, [capability, regionFilter, selectedState, selectedDistrict, signal]);

  useEffect(() => {
    const cacheKey = `${capability}|${regionFilter}|${selectedState ?? ''}|${selectedDistrict ?? ''}|${signal}`;
    const cached = facilitiesCache.current.get(cacheKey);
    if (cached) setFacilities(cached);
    else setFacilities([]);

    let cancelled = false;
    api
      .facilities({
        capability,
        region: regionFilter !== 'all' ? regionFilter : undefined,
        state: selectedState ?? undefined,
        district: selectedDistrict ?? undefined,
        signal: signal === 'all' ? undefined : signal,
        limit: 120,
      })
      .then((res) => {
        if (cancelled) return;
        facilitiesCache.current.set(cacheKey, res.results);
        setFacilities(res.results);
      })
      .catch(() => {
        if (!cancelled && !cached) setFacilities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [capability, regionFilter, selectedState, selectedDistrict, signal]);

  const handleMapHover = useCallback((h: HoverInfo | null) => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      setHover(h);
      setHoveredFacilityId(h?.kind === 'facility' ? h.facility?.facilityId ?? null : null);
    }, h ? 60 : 120);
  }, []);

  useEffect(() => () => { if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current); }, []);

  const stateRatings: StateRating[] = useMemo(
    () => rollupStateRatings(geo?.states ?? []),
    [geo],
  );
  const districtRatings: DistrictRating[] = useMemo(() => geo?.districts ?? [], [geo]);
  const mapDistrictRatings = useMemo(
    () => (selectedState ? districtRatings.filter((d) => d.state === selectedState) : []),
    [districtRatings, selectedState],
  );

  const facilityTypes = useMemo(() => Array.from(new Set(facilities.map((f) => f.type))).sort(), [facilities]);
  const filteredFacilities = useMemo(
    () =>
      facilities.filter(
        (f) =>
          (typeFilter === 'all' || f.type === typeFilter) &&
          (f.beds ?? 0) >= minBeds &&
          Math.round(effectiveTrustScore(f) * 100) >= minTrustScore,
      ),
    [facilities, typeFilter, minBeds, minTrustScore],
  );

  /** Keep the search-selected facility visible on the map even if outside the top-N list. */
  const mapFacilities = useMemo(() => {
    if (!selectedFacility) return filteredFacilities;
    if (filteredFacilities.some((f) => f.facilityId === selectedFacility.facilityId)) return filteredFacilities;
    return [selectedFacility, ...filteredFacilities];
  }, [filteredFacilities, selectedFacility]);

  const level = selectedDistrict ? 'district' : selectedState ? 'state' : 'nation';
  const viewportRevision = `${level}|${capability}|${display}|${activeMetric.key}`;
  const viewportInset = useMapViewportInset(mapAreaRef, mapRailRef, mapLegendRef, viewportRevision);
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
    const acc = { facilities: 0, claiming: 0, strong: 0, partial: 0, weak: 0, noClaim: 0, scoreSum: 0 };
    for (const s of stateRatings) {
      acc.facilities += s.facilities;
      acc.claiming += s.claiming;
      acc.strong += s.strong;
      acc.partial += s.partial;
      acc.weak += s.weak;
      acc.noClaim += s.noClaim ?? 0;
      if (s.avgScore !== null) acc.scoreSum += s.avgScore * s.claiming;
    }
    return {
      facilities: acc.facilities,
      claiming: acc.claiming,
      strong: acc.strong,
      partial: acc.partial,
      weak: acc.weak,
      noClaim: acc.noClaim,
      avgScore: acc.claiming > 0 ? acc.scoreSum / acc.claiming : null,
    };
  }, [stateRatings]);

  const selStateRating = useMemo(() => stateRatings.find((s) => s.state === selectedState) ?? null, [stateRatings, selectedState]);
  const selDistrictRating = useMemo(
    () => districtRatings.find((d) => d.state === selectedState && d.district === selectedDistrict) ?? null,
    [districtRatings, selectedState, selectedDistrict],
  );

  // Colour-gradient domain for the legend and map shading — min/max within the
  // current geography scope (nation states, state districts, or district facilities).
  const legendDomain = useMemo<[number, number] | null>(() => {
    const vals =
      level === 'nation'
        ? stateRatings.map(valueOfState)
        : districtRatings
            .filter((d) => d.state === selectedState)
            .map(valueOfDistrict);
    return metricExtent(vals);
  }, [level, selectedState, stateRatings, districtRatings, valueOfState, valueOfDistrict]);

  const colorDomain = legendDomain ?? (isRate ? [0, 1] : [0, 1]);

  const legendFacilityCounts = useMemo(() => {
    if (level === 'nation') return stateRatings.map((s) => s.facilities);
    if (level === 'state') return districtRatings.filter((d) => d.state === selectedState).map((d) => d.facilities);
    return filteredFacilities.length ? [filteredFacilities.length] : [];
  }, [level, stateRatings, districtRatings, selectedState, filteredFacilities.length]);

  // active-metric value + peer rank for the focused (or hovered) region
  const readout = useMemo((): {
    geoLevel: ReadoutGeoLevel;
    name: string;
    scope: string;
    value: number | null;
  } => {
    if (selectedFacility) {
      return {
        geoLevel: 'facility',
        name: selectedFacility.name,
        scope: `${selectedFacility.district}, ${selectedFacility.state}`,
        value: effectiveTrustScore(selectedFacility),
      };
    }

    const hoverRating = hover && (hover.kind === 'state' || hover.kind === 'district') ? hover.rating ?? null : null;

    if (hover?.kind === 'facility' && hover.facility) {
      return {
        geoLevel: 'facility',
        name: hover.facility.name,
        scope: `${hover.facility.district}, ${hover.facility.state}`,
        value: effectiveTrustScore(hover.facility),
      };
    }

    if (hover?.kind === 'district' || level === 'district') {
      const dr = (hoverRating as DistrictRating) ?? (hover?.kind === 'district' ? null : selDistrictRating);
      if (dr) return { geoLevel: 'district', name: dr.district, scope: `${dr.state}`, value: valueOfDistrict(dr) };
      const name = hover?.kind === 'district' ? hover.name : selectedDistrict;
      if (name) {
        return {
          geoLevel: 'district',
          name,
          scope: selectedState ?? 'District',
          value: null,
        };
      }
    }
    if (hover?.kind === 'state' || level === 'state') {
      const sr = (hoverRating as StateRating) ?? (hover?.kind === 'state' ? null : selStateRating);
      if (sr) return { geoLevel: 'state', name: sr.state, scope: 'India', value: valueOfState(sr) };
      const name = hover?.kind === 'state' ? hover.name : selectedState;
      if (name) return { geoLevel: 'state', name, scope: 'India', value: null };
    }
    const v = activeMetric.source === 'builtin' ? builtinValue(national, activeMetric.key as BuiltinMetric) : store?.national ?? null;
    return {
      geoLevel: 'nation',
      name: 'India',
      scope: regionFilter === 'all' ? 'All states' : `${regionFilter} region`,
      value: v,
    };
  }, [hover, level, selectedState, selectedDistrict, selectedFacility, selDistrictRating, selStateRating, valueOfState, valueOfDistrict, activeMetric, national, store, regionFilter]);

  const drillToNation = useCallback(() => {
    setSelectedState(null);
    setSelectedDistrict(null);
    setSelectedFacility(null);
  }, []);

  const drillToState = useCallback((s: string | null) => {
    if (!s) {
      setSelectedState(null);
      setSelectedDistrict(null);
      setSelectedFacility(null);
      return;
    }
    const matchedState = geo?.states.find((st) => placeMatch(st.state, s))?.state ?? s;
    setSelectedState(matchedState);
    setSelectedDistrict(null);
    setSelectedFacility(null);
  }, [geo]);

  const drillToDistrict = useCallback((d: string | null) => {
    setSelectedDistrict(d);
    setSelectedFacility(null);
  }, []);

  const drillToLocation = useCallback((state: string, district?: string | null) => {
    setSelectedFacility(null);
    const matchedState = geo?.states.find((s) => placeMatch(s.state, state))?.state ?? state;
    setSelectedState(matchedState);
    if (!district) {
      setSelectedDistrict(null);
      return;
    }
    const matchedDistrict =
      geo?.districts.find((d) => placeMatch(d.state, matchedState) && placeMatch(d.district, district))
        ?.district ?? district;
    setSelectedDistrict(matchedDistrict);
  }, [geo]);

  const goBack = useCallback(() => {
    if (selectedFacility) setSelectedFacility(null);
    else if (selectedDistrict) drillToState(selectedState);
    else drillToNation();
  }, [selectedFacility, selectedDistrict, selectedState, drillToState, drillToNation]);
  const activeCap = capabilities.find((c) => c.key === capability);

  return (
    <div className="mx-auto flex h-[calc(100vh-9.5rem)] max-w-[1500px] flex-col gap-3">
      {/* capability pills */}
      <div className="flex flex-wrap items-center gap-1.5">
          {capabilities.map((c) => {
            const active = capability === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={active}
                onClick={() => setCapability(c.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-all ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-card text-muted-foreground hover:-translate-y-px hover:border-primary/40 hover:text-foreground'
                }`}
              >
                {c.label}
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-1.5 text-xs font-bold tabular-nums ${
                    active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-primary-foreground' : 'bg-emerald-500'}`} />
                  {capabilityPillCount(c)}
                </span>
              </button>
            );
          })}
      </div>

      {topoError && (
        <Alert variant="destructive">
          <AlertTitle>Map unavailable</AlertTitle>
          <AlertDescription>{topoError}</AlertDescription>
        </Alert>
      )}

      {/* map · right readout */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_300px]">
        {/* map + controls */}
        <div className="flex min-h-0 flex-col gap-2">
          <MapGeoBreadcrumb
            selectedState={selectedState}
            selectedDistrict={selectedDistrict}
            selectedFacility={selectedFacility}
            districtsLoading={selectedState !== null && needsDistrictTopo && !districtTopo && !districtTopoFailed}
            districtsLoadFailed={districtTopoFailed}
            onNation={drillToNation}
            onState={drillToState}
            onDistrict={drillToDistrict}
            onBack={goBack}
            search={
              <MapFacilitySearch
                capability={capability}
                onSelect={selectFacility}
                onSelectState={drillToState}
                onSelectDistrict={drillToLocation}
              />
            }
            actions={
              <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
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
                  <GeoFilterList
                    value={selectedState}
                    onChange={(v) => {
                      if (!v) drillToNation();
                      else drillToState(v);
                    }}
                    options={stateRatings.map((s) => ({
                      value: s.state,
                      label: s.state,
                      hint: `${s.facilities.toLocaleString()} facilities`,
                    }))}
                    allLabel="All states"
                    searchPlaceholder="Search states…"
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">District</span>
                  <GeoFilterList
                    value={selectedDistrict}
                    onChange={(v) => {
                      if (!v) setSelectedDistrict(null);
                      else if (selectedState) drillToLocation(selectedState, v);
                    }}
                    options={districtRatings
                      .filter((d) => d.state === selectedState)
                      .map((d) => ({
                        value: d.district,
                        label: d.district,
                        hint: `${d.facilities.toLocaleString()} facilities`,
                      }))}
                    allLabel="All districts"
                    searchPlaceholder="Search districts…"
                    disabled={!selectedState}
                  />
                </div>
                <Separator />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setRegionFilter('all');
                    drillToNation();
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
              </>
            }
          />

          <div ref={mapAreaRef} className="relative min-h-[360px] flex-1" data-demo="navigator-map">
            {topology && topologyHasStates(topology) ? (
              <DrilldownMap
                topology={topology}
                districtTopology={districtTopology}
                worldTopology={worldTopology}
                stateRatings={stateRatings}
                districtRatings={mapDistrictRatings}
                facilities={mapFacilities}
                selectedState={selectedState}
                selectedDistrict={selectedDistrict}
                hoveredFacilityId={hoveredFacilityId}
                selectedFacilityId={selectedFacility?.facilityId ?? null}
                selectedFacility={selectedFacility}
                display={display}
                showPins={showPins}
                logScale={effectiveLog}
                ramp={ramp}
                colorDomain={colorDomain}
                valueOfState={valueOfState}
                valueOfDistrict={valueOfDistrict}
                onSelectState={drillToState}
                onSelectDistrict={drillToDistrict}
                onSelectFacility={selectFacility}
                onHover={handleMapHover}
                districtLayersReady={districtLayersReady}
                viewportInset={viewportInset}
              />
            ) : (
              !topoError && <Skeleton className="h-full w-full rounded-xl" />
            )}

            {/* left overlay: tool rail (top-left) + legend (bottom-left, may be wider than rail) */}
            <div className="pointer-events-none absolute inset-2 z-10">
              <div ref={mapRailRef} className="pointer-events-auto absolute left-0 top-0 w-9">
                <MapToolRail
                  flyout={mapFlyout}
                  onFlyoutChange={setMapFlyout}
                  showPins={showPins}
                  onShowPinsChange={setShowPins}
                  canHome={!!(selectedState || selectedDistrict)}
                  onHome={drillToNation}
                  display={display}
                  onDisplayChange={setDisplay}
                  logScale={effectiveLog}
                  logDisabled={logDisabled}
                  onLogScaleChange={setLogScale}
                  groups={groups}
                  activeMetric={activeMetric}
                  onMetricChange={setActiveMetric}
                />
              </div>
              <div ref={mapLegendRef} className="pointer-events-auto absolute bottom-0 left-0">
                <MapLegend
                  level={level}
                  activeMetric={activeMetric}
                  effectiveLog={effectiveLog}
                  display={display}
                  ramp={ramp}
                  domain={legendDomain}
                  capabilityLabel={activeCap?.label}
                  facilityCounts={legendFacilityCounts}
                />
              </div>
            </div>
          </div>
        </div>

        {/* readout + scorecard */}
        <aside className="flex min-h-0 flex-col">
          <ScrollArea className="min-h-0 flex-1 pr-2">
            <div className="space-y-3">
              <MetricReadout
                geoLevel={readout.geoLevel}
                regionName={readout.name}
                scope={readout.scope}
                metric={activeMetric}
                value={readout.value}
              />

              <MapDrilldownPanel
                level={level}
                hover={hover}
                selectedState={selectedState}
                selectedDistrict={selectedDistrict}
                selectedFacility={selectedFacility}
                selStateRating={selStateRating}
                selDistrictRating={selDistrictRating}
                national={national}
                capability={capability}
                capabilityLabel={activeCap?.label}
                onCloseFacility={() => setSelectedFacility(null)}
                onClearHover={() => setHover(null)}
                onFacilityUpdated={handleFacilityUpdated}
              />

              <div className="flex items-center justify-between px-0.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Facility rankings {level !== 'nation' && `· ${selectedDistrict ?? selectedState}`}
                </span>
                <Badge variant="outline" className="text-[10px]">{filteredFacilities.length}</Badge>
              </div>

              {filteredFacilities.length === 0 ? (
                <p className="px-0.5 text-xs text-muted-foreground">
                  {level === 'district' && (selDistrictRating?.facilities ?? 0) > 0
                    ? `Facilities in this district are listed when you drill down; none match the current trust or type filters for ${activeCap?.label ?? 'this capability'}.`
                    : `No facilities claim ${activeCap?.label ?? 'this capability'} for the current scope and filters.`}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {filteredFacilities.slice(0, 60).map((f) => {
                    const sig = effectiveTrustSignal(f);
                    const score = effectiveTrustScore(f);
                    const isSel = selectedFacility?.facilityId === f.facilityId;
                    return (
                      <button
                        key={f.facilityId}
                        type="button"
                        onMouseEnter={() => setHoveredFacilityId(f.facilityId)}
                        onMouseLeave={() => setHoveredFacilityId(null)}
                        onClick={() => selectFacility(f)}
                        className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                          isSel ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50'
                        }`}
                      >
                        <span className="text-xs font-semibold tabular-nums text-muted-foreground">#{f.rank}</span>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SIGNAL_COLORS[sig] }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{f.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{f.district} · {f.type}</span>
                        </span>
                        <span className="min-w-[2rem] text-right text-sm font-bold tabular-nums text-foreground">{Math.round(score * 100)}</span>
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
