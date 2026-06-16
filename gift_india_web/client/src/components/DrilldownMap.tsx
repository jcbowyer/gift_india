import { useEffect, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath, type GeoProjection } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type D3ZoomEvent, ZoomTransform } from 'd3-zoom';
import 'd3-transition'; // augments selection.prototype.transition (used by zoom.transform tweens)
import { scaleLinear, scaleSqrt } from 'd3-scale';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { FacilityRanking, StateRating, DistrictRating } from '../lib/api';
import { SIGNAL_COLORS, normName, placeMatch } from '../lib/mapPalette';

export type MapLevel = 'nation' | 'state' | 'district';
export type MapDisplay = 'shade' | 'bubble';

export interface HoverInfo {
  kind: 'state' | 'district' | 'facility';
  name: string;
  sub?: string;
  rating?: StateRating | DistrictRating;
  facility?: FacilityRanking;
}

interface DrilldownMapProps {
  topology: Topology;
  stateRatings: StateRating[];
  districtRatings: DistrictRating[];
  facilities: FacilityRanking[];
  selectedState: string | null; // data state name
  selectedDistrict: string | null; // data district name
  hoveredFacilityId: string | null;
  selectedFacilityId: string | null;
  display: MapDisplay;
  logScale: boolean;
  ramp: string[]; // low → high colour stops for the active metric
  isRate: boolean; // 0–1 metric (fixed domain) vs data-extent metric
  valueOfState: (s: StateRating) => number | null;
  valueOfDistrict: (d: DistrictRating) => number | null;
  onSelectState: (dataState: string | null) => void;
  onSelectDistrict: (dataDistrict: string | null) => void;
  onSelectFacility: (f: FacilityRanking | null) => void;
  onHover: (h: HoverInfo | null) => void;
}

interface StateProps { st_nm: string }
interface DistrictProps { district: string; st_nm: string }

const MAX_K = 48;
const EMPTY = '#e8edf2';
const logT = (v: number) => Math.log10(v + 1);

export function DrilldownMap({
  topology,
  stateRatings,
  districtRatings,
  facilities,
  selectedState,
  selectedDistrict,
  hoveredFacilityId,
  selectedFacilityId,
  display,
  logScale,
  ramp,
  isRate,
  valueOfState,
  valueOfDistrict,
  onSelectState,
  onSelectDistrict,
  onSelectFacility,
  onHover,
}: DrilldownMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);

  const level: MapLevel = selectedDistrict ? 'district' : selectedState ? 'state' : 'nation';
  const selectedStateNorm = selectedState ? normName(selectedState) : null;

  // ── topo features ──────────────────────────────────────────────────────────
  const { statesFC, statesMesh, districtsByState } = useMemo(() => {
    const sfc = feature(topology, topology.objects.states as GeometryCollection) as FeatureCollection<Geometry, StateProps>;
    const smesh = mesh(topology, topology.objects.states as GeometryCollection, (a, b) => a !== b);
    const dfc = feature(topology, topology.objects.districts as GeometryCollection) as FeatureCollection<Geometry, DistrictProps>;
    const byState = new Map<string, Feature<Geometry, DistrictProps>[]>();
    for (const f of dfc.features) {
      const k = normName(f.properties.st_nm);
      (byState.get(k) ?? byState.set(k, []).get(k)!).push(f);
    }
    return { statesFC: sfc, statesMesh: smesh, districtsByState: byState };
  }, [topology]);

  // ── rating lookups ─────────────────────────────────────────────────────────
  const stateByNorm = useMemo(() => new Map(stateRatings.map((r) => [normName(r.state), r])), [stateRatings]);
  const districtsHere = useMemo(
    () => (selectedStateNorm ? districtsByState.get(selectedStateNorm) ?? [] : []),
    [districtsByState, selectedStateNorm],
  );
  const districtRatingsHere = useMemo(
    () => districtRatings.filter((d) => d.state === selectedState),
    [districtRatings, selectedState],
  );
  const matchDistrictRating = (topoName: string) =>
    districtRatingsHere.find((d) => placeMatch(d.district, topoName)) ?? null;

  // ── projection fitted to India ─────────────────────────────────────────────
  const projection = useMemo<GeoProjection | null>(() => {
    if (!size.width || !size.height) return null;
    return geoMercator().fitSize([size.width, size.height], statesFC);
  }, [size.width, size.height, statesFC]);
  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  const stateCentroids = useMemo(() => {
    const m = new Map<string, [number, number]>();
    if (path) for (const f of statesFC.features) m.set(normName(f.properties.st_nm), path.centroid(f));
    return m;
  }, [path, statesFC]);

  // ── metric value → colour + facility-count → bubble size (per level) ────────
  const { colorOf, sizeOf } = useMemo(() => {
    // values + facility counts for the regions currently in view
    const values: number[] = [];
    const facCounts: number[] = [];
    if (level === 'nation') {
      for (const s of stateRatings) {
        const v = valueOfState(s);
        if (v !== null && Number.isFinite(v)) values.push(v);
        facCounts.push(s.facilities);
      }
    } else {
      for (const d of districtRatingsHere) {
        const v = valueOfDistrict(d);
        if (v !== null && Number.isFinite(v)) values.push(v);
        facCounts.push(d.facilities);
      }
    }

    // colour scale
    let color: (v: number | null) => string;
    if (isRate) {
      const stops = ramp.map((_, i) => i / (ramp.length - 1));
      const s = scaleLinear<string>().domain(stops).range(ramp).clamp(true);
      color = (v) => (v === null || !Number.isFinite(v) ? EMPTY : s(v));
    } else {
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 1;
      const lo = logScale ? logT(min) : min;
      const hi = logScale ? logT(max) : max;
      if (hi <= lo) {
        const top = ramp[ramp.length - 1];
        color = (v) => (v === null || !Number.isFinite(v) ? EMPTY : top);
      } else {
        const stops = ramp.map((_, i) => lo + ((hi - lo) * i) / (ramp.length - 1));
        const s = scaleLinear<string>().domain(stops).range(ramp).clamp(true);
        color = (v) => (v === null || !Number.isFinite(v) ? EMPTY : s(logScale ? logT(v) : v));
      }
    }

    // bubble size from facility count
    const facMax = Math.max(1, ...facCounts);
    const dfac = logScale ? logT(facMax) : facMax;
    const sq = scaleSqrt().domain([0, dfac]).range([3, 26]);
    const sizeFn = (f: number) => sq(logScale ? logT(f) : f);
    return { colorOf: color, sizeOf: sizeFn };
  }, [level, stateRatings, districtRatingsHere, isRate, ramp, logScale, valueOfState, valueOfDistrict]);

  // ── responsive sizing ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── attach d3.zoom once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, MAX_K])
      .clickDistance(4)
      .on('zoom', (e: D3ZoomEvent<SVGSVGElement, unknown>) => setTransform(e.transform));
    zoomRef.current = z;
    select(svgRef.current).call(z);
  }, []);

  // ── smooth zoom-to-bounds on drill (van Wijk via zoom.transform transition) ─
  useEffect(() => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z || !path || !projection || !size.width) return;

    const animate = (t: ZoomTransform) =>
      select(svg)
        .transition()
        .duration(750)
        // eslint-disable-next-line @typescript-eslint/unbound-method
        .call(z.transform, t);
    const apply = (k: number, cx: number, cy: number) =>
      animate(zoomIdentity.translate(size.width / 2, size.height / 2).scale(k).translate(-cx, -cy));

    if (level === 'nation') {
      animate(zoomIdentity);
      return;
    }
    if (level === 'state' && selectedState) {
      const f = statesFC.features.find((x) => normName(x.properties.st_nm) === normName(selectedState));
      if (f) {
        const [[x0, y0], [x1, y1]] = path.bounds(f);
        const k = Math.min(MAX_K, 0.9 / Math.max((x1 - x0) / size.width, (y1 - y0) / size.height));
        apply(k, (x0 + x1) / 2, (y0 + y1) / 2);
      }
      return;
    }
    if (level === 'district' && selectedDistrict) {
      const pts = facilities
        .filter((f) => f.lat != null && f.lon != null)
        .map((f) => projection([f.lon as number, f.lat as number]) as [number, number]);
      if (pts.length >= 2) {
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const pad = 40;
        const k = Math.min(MAX_K, 0.9 / Math.max((x1 - x0 + pad) / size.width, (y1 - y0 + pad) / size.height));
        apply(k, (x0 + x1) / 2, (y0 + y1) / 2);
      } else {
        const dr = districtRatings.find((d) => d.district === selectedDistrict && d.state === selectedState);
        if (dr && dr.lat != null && dr.lon != null) {
          const [cx, cy] = projection([dr.lon, dr.lat]) as [number, number];
          apply(20, cx, cy);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, selectedState, selectedDistrict, facilities, path, projection, size.width, size.height]);

  // ── manual zoom controls (in / out / reset) ────────────────────────────────
  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    select(svg).transition().duration(250).call(z.scaleBy, factor);
  };
  const resetZoom = () => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    select(svg).transition().duration(400).call(z.transform, zoomIdentity);
  };

  const k = transform.k;
  if (!path || !projection) return <div ref={containerRef} className="h-full w-full" />;

  const districtPings = level === 'nation' ? [] : districtRatingsHere.filter((d) => d.lat != null && d.lon != null);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-xl border bg-[#f8fafc]">
      <svg ref={svgRef} width={size.width} height={size.height} className="block touch-none">
        <g transform={transform.toString()}>
          {/* ── state polygons ── */}
          {statesFC.features.map((f) => {
            const r = stateByNorm.get(normName(f.properties.st_nm));
            const isSel = selectedStateNorm === normName(f.properties.st_nm);
            const dim = level !== 'nation' && !isSel;
            const fill =
              level !== 'nation'
                ? isSel
                  ? '#ffffff'
                  : '#eef2f6'
                : display === 'shade'
                  ? colorOf(r ? valueOfState(r) : null)
                  : '#eef2f6';
            return (
              <path
                key={`st-${f.properties.st_nm}`}
                d={path(f) ?? undefined}
                fill={fill}
                fillOpacity={dim ? 0.55 : 1}
                stroke="#94a3b8"
                strokeWidth={isSel ? 1.4 : 0.6}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: level === 'nation' && r ? 'pointer' : 'default', transition: 'fill-opacity 200ms' }}
                onMouseEnter={() =>
                  onHover(
                    r
                      ? { kind: 'state', name: r.state, sub: `${r.facilities} facilities`, rating: r }
                      : { kind: 'state', name: f.properties.st_nm, sub: 'No surveyed facilities' },
                  )
                }
                onMouseLeave={() => onHover(null)}
                onClick={() => level === 'nation' && r && onSelectState(r.state)}
              />
            );
          })}

          <path d={path(statesMesh) ?? undefined} fill="none" stroke="#cbd5e1" strokeWidth={0.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />

          {/* ── district polygons of the selected state ── */}
          {level !== 'nation' &&
            districtsHere.map((f) => {
              const dr = matchDistrictRating(f.properties.district);
              const isSelDist = dr ? dr.district === selectedDistrict : false;
              const shaded = display === 'shade';
              return (
                <path
                  key={`dt-${f.properties.district}`}
                  d={path(f) ?? undefined}
                  fill={shaded ? colorOf(dr ? valueOfDistrict(dr) : null) : 'none'}
                  fillOpacity={shaded ? 0.92 : 0}
                  stroke={isSelDist ? '#0f172a' : '#cbd5e1'}
                  strokeWidth={isSelDist ? 1.2 : 0.5}
                  strokeDasharray={shaded ? undefined : '2 2'}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: dr ? 'pointer' : 'default' }}
                  onMouseEnter={() =>
                    dr && onHover({ kind: 'district', name: dr.district, sub: `${dr.state} · ${dr.facilities} facilities`, rating: dr })
                  }
                  onMouseLeave={() => onHover(null)}
                  onClick={() => dr && onSelectDistrict(dr.district)}
                  pointerEvents={shaded ? 'auto' : 'none'}
                />
              );
            })}

          {/* ── bubble mode: state centroids (nation) ── */}
          {level === 'nation' &&
            display === 'bubble' &&
            stateRatings.map((s) => {
              const c = stateCentroids.get(normName(s.state));
              if (!c) return null;
              return (
                <circle
                  key={`sb-${s.state}`}
                  cx={c[0]}
                  cy={c[1]}
                  r={sizeOf(s.facilities) / k}
                  fill={colorOf(valueOfState(s))}
                  fillOpacity={0.78}
                  stroke="#1e293b"
                  strokeWidth={0.8 / k}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => onHover({ kind: 'state', name: s.state, sub: `${s.facilities} facilities`, rating: s })}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onSelectState(s.state)}
                />
              );
            })}

          {/* ── bubble mode: district centroids (state) ── */}
          {level !== 'nation' &&
            display === 'bubble' &&
            districtPings.map((d) => {
              const [cx, cy] = projection([d.lon as number, d.lat as number]) as [number, number];
              const isSel = d.district === selectedDistrict;
              return (
                <circle
                  key={`db-${d.district}`}
                  cx={cx}
                  cy={cy}
                  r={sizeOf(d.facilities) / k}
                  fill={colorOf(valueOfDistrict(d))}
                  fillOpacity={0.78}
                  stroke={isSel ? '#0f172a' : '#1e293b'}
                  strokeWidth={(isSel ? 2 : 0.8) / k}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => onHover({ kind: 'district', name: d.district, sub: `${d.state} · ${d.facilities} facilities`, rating: d })}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onSelectDistrict(d.district)}
                />
              );
            })}

          {/* ── facility pins (district level) ── */}
          {level === 'district' &&
            facilities
              .filter((f) => f.lat != null && f.lon != null)
              .map((f) => {
                const [cx, cy] = projection([f.lon as number, f.lat as number]) as [number, number];
                const isHover = f.facilityId === hoveredFacilityId;
                const isSel = f.facilityId === selectedFacilityId;
                const sig = f.overrideSignal ?? f.trustSignal;
                const r = (isSel ? 7 : isHover ? 6 : 4.5) / k;
                return (
                  <circle
                    key={`fp-${f.facilityId}`}
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={SIGNAL_COLORS[sig]}
                    fillOpacity={0.9}
                    stroke={isSel ? '#0f172a' : '#ffffff'}
                    strokeWidth={(isSel ? 2 : 1) / k}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => onHover({ kind: 'facility', name: f.name, sub: `${f.district}, ${f.state}`, facility: f })}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelectFacility(f)}
                  />
                );
              })}
        </g>
      </svg>

      {/* zoom controls + level indicator */}
      <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1">
        <div className="flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white/90 shadow-sm">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.6)}
            disabled={k >= MAX_K - 1e-3}
            className="flex h-7 w-7 items-center justify-center text-lg leading-none text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.6)}
            disabled={k <= 1 + 1e-3}
            className="flex h-7 w-7 items-center justify-center border-t border-slate-200 text-lg leading-none text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            onClick={resetZoom}
            disabled={k <= 1 + 1e-3}
            title="Reset view"
            className="flex h-7 w-7 items-center justify-center border-t border-slate-200 text-xs leading-none text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            ⤢
          </button>
        </div>
        <div className="rounded bg-white/80 px-2 py-1 text-[10px] font-medium text-slate-500 shadow-sm">
          {k.toFixed(1)}×
        </div>
      </div>
    </div>
  );
}
