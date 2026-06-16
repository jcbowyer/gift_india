import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath, geoBounds, type GeoProjection } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition'; // augments selection.prototype with .transition() (used for fly-to)
import { zoom as d3zoom, zoomIdentity, zoomTransform, type ZoomBehavior, type D3ZoomEvent, ZoomTransform } from 'd3-zoom';
import { scaleLinear, scaleSqrt } from 'd3-scale';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { FacilityRanking, StateRating, DistrictRating } from '../lib/api';
import { SIGNAL_COLORS, normName, titleCase } from '../lib/mapPalette';
import { DistrictLocator, districtKey } from '../lib/geoAssign';

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
  worldTopology?: Topology | null; // optional world-countries backdrop (India-corrected)
  stateRatings: StateRating[];
  districtRatings: DistrictRating[];
  facilities: FacilityRanking[];
  selectedState: string | null; // data state name
  selectedDistrict: string | null; // data district name
  hoveredFacilityId: string | null;
  selectedFacilityId: string | null;
  display: MapDisplay;
  showPins?: boolean;
  logScale: boolean;
  ramp: string[]; // low → high colour stops for the active metric
  isRate: boolean; // 0–1 metric (fixed domain) vs data-extent metric
  valueOfState: (s: StateRating) => number | null;
  valueOfDistrict: (d: DistrictRating) => number | null;
  onSelectState: (dataState: string | null) => void;
  onSelectDistrict: (dataDistrict: string | null) => void;
  onSelectFacility: (f: FacilityRanking | null) => void;
  onHover: (h: HoverInfo | null) => void;
  onReady?: () => void;
}

interface StateProps { st_nm: string }
interface DistrictProps { district: string; st_nm: string }

/** Topology district reconciled with the rating(s) whose centroids fall inside it. */
interface TopoDistrict {
  key: string; // districtKey(stateNorm, districtNorm)
  stateNorm: string;
  districtNorm: string;
  primary: DistrictRating; // representative rating (most facilities) — drives shading + drill
  facilities: number; // summed facility count across all ratings in this polygon
}

const MAX_K = 48;
const EMPTY = '#e8edf2';
const CLUSTER_PX = 46; // screen-space radius at which nearby pins collapse into a cluster
const GEO_CLUSTER_PX = 54; // geography centroid clustering threshold
const logT = (v: number) => Math.log10(v + 1);

export function DrilldownMap({
  topology,
  worldTopology,
  stateRatings,
  districtRatings,
  facilities,
  selectedState,
  selectedDistrict,
  hoveredFacilityId,
  selectedFacilityId,
  display,
  showPins = true,
  logScale,
  ramp,
  isRate,
  valueOfState,
  valueOfDistrict,
  onSelectState,
  onSelectDistrict,
  onSelectFacility,
  onHover,
  onReady,
}: DrilldownMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Zoom scale only — the pan/zoom transform is written straight to the <g> DOM
  // node in the zoom handler (no React re-render per frame). `zoomK` is updated
  // in coarse steps so the few k-dependent layers (bubbles, clusters, pins) keep
  // a constant on-screen size without thrashing the whole SVG tree.
  const [zoomK, setZoomK] = useState(1);

  const level: MapLevel = selectedDistrict ? 'district' : selectedState ? 'state' : 'nation';
  const selectedStateNorm = selectedState ? normName(selectedState) : null;

  // ── hover events coalesced to one re-render per frame ───────────────────────
  // Hover bubbles up to the page (drives the readout panel), so a fast sweep
  // across many small districts/pins would otherwise re-render the whole page
  // per element crossed. rAF-coalescing caps that at the frame rate.
  const hoverRaf = useRef<number | null>(null);
  const pendingHover = useRef<HoverInfo | null>(null);
  const emitHover = useCallback((h: HoverInfo | null) => {
    pendingHover.current = h;
    if (hoverRaf.current != null) return;
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = null;
      onHover(pendingHover.current);
    });
  }, [onHover]);
  useEffect(() => () => { if (hoverRaf.current != null) cancelAnimationFrame(hoverRaf.current); }, []);

  // ── topo features (states always; districts deferred until a state is selected) ─
  const { statesFC, statesMesh } = useMemo(() => {
    const sfc = feature(topology, topology.objects.states as GeometryCollection) as FeatureCollection<Geometry, StateProps>;
    const smesh = mesh(topology, topology.objects.states as GeometryCollection, (a, b) => a !== b);
    return { statesFC: sfc, statesMesh: smesh };
  }, [topology]);

  const districtsByState = useMemo(() => {
    if (!selectedStateNorm) return new Map<string, Feature<Geometry, DistrictProps>[]>();
    const dfc = feature(topology, topology.objects.districts as GeometryCollection) as FeatureCollection<Geometry, DistrictProps>;
    const byState = new Map<string, Feature<Geometry, DistrictProps>[]>();
    for (const f of dfc.features) {
      const k = normName(f.properties.st_nm);
      (byState.get(k) ?? byState.set(k, []).get(k)!).push(f);
    }
    return byState;
  }, [topology, selectedStateNorm]);

  // Locator + district reconciliation are expensive — skip at nation level.
  const locator = useMemo(
    () => (selectedStateNorm ? new DistrictLocator(topology) : null),
    [topology, selectedStateNorm],
  );

  const topoDistrictsByState = useMemo(() => {
    const empty = { byKey: new Map<string, TopoDistrict>(), byState: new Map<string, TopoDistrict[]>() };
    if (!locator || !selectedStateNorm) return empty;

    const byKey = new Map<string, TopoDistrict>();
    for (const r of districtRatings) {
      if (r.lat == null || r.lon == null) continue;
      const hit = locator.locate(r.lon, r.lat);
      if (!hit || hit.stateNorm !== selectedStateNorm) continue;
      const key = districtKey(hit.stateNorm, hit.districtNorm);
      const cur = byKey.get(key);
      if (!cur) {
        byKey.set(key, { key, stateNorm: hit.stateNorm, districtNorm: hit.districtNorm, primary: r, facilities: r.facilities });
      } else {
        cur.facilities += r.facilities;
        if (r.facilities > cur.primary.facilities) cur.primary = r;
      }
    }
    const byState = new Map<string, TopoDistrict[]>();
    for (const td of byKey.values()) (byState.get(td.stateNorm) ?? byState.set(td.stateNorm, []).get(td.stateNorm)!).push(td);
    return { byKey, byState };
  }, [districtRatings, locator, selectedStateNorm]);

  // ── nation outline (SoI India boundary) for the floating-landmass look ───────
  const nationFC = useMemo(() => {
    const obj = topology.objects.nation as GeometryCollection | undefined;
    return obj ? (feature(topology, obj) as FeatureCollection) : null;
  }, [topology]);

  // ── world-countries backdrop (India-corrected); shown only at nation level ───
  const worldFC = useMemo(() => {
    if (!worldTopology) return null;
    const obj = worldTopology.objects.countries as GeometryCollection | undefined;
    if (!obj) return null;
    const fc = feature(worldTopology, obj) as FeatureCollection;
    const [W, S, E, N] = [55, -8, 112, 46]; // generous window around the subcontinent
    fc.features = fc.features.filter((f) => {
      const [[w, s], [e, n]] = geoBounds(f);
      return e >= W && w <= E && n >= S && s <= N && e - w < 120; // skip world-spanning bboxes
    });
    return fc;
  }, [worldTopology]);

  // ── rating lookups ─────────────────────────────────────────────────────────
  const stateByNorm = useMemo(() => new Map(stateRatings.map((r) => [normName(r.state), r])), [stateRatings]);
  const districtsHere = useMemo(
    () => (selectedStateNorm ? districtsByState.get(selectedStateNorm) ?? [] : []),
    [districtsByState, selectedStateNorm],
  );
  const topoDistrictsHere = useMemo(
    () => (selectedStateNorm ? topoDistrictsByState.byState.get(selectedStateNorm) ?? [] : []),
    [topoDistrictsByState, selectedStateNorm],
  );
  // Reconciled rating for a topology district feature (null when it has no data).
  const dataForFeature = useCallback(
    (f: Feature<Geometry, DistrictProps>): TopoDistrict | null =>
      topoDistrictsByState.byKey.get(districtKey(normName(f.properties.st_nm), normName(f.properties.district))) ?? null,
    [topoDistrictsByState],
  );

  // Topo feature for the focused district — frames the district level on its own
  // polygon (stable) rather than the async facility point-cloud (jittery).
  const selectedDistrictFeature = useMemo(() => {
    if (!selectedDistrict) return null;
    const sel = normName(selectedDistrict);
    // Match either the reconciled rating's district name (data districts) or the
    // boundary's own name (data-less districts drilled straight from the polygon).
    return (
      districtsHere.find(
        (f) => dataForFeature(f)?.primary.district === selectedDistrict || normName(f.properties.district) === sel,
      ) ?? null
    );
  }, [selectedDistrict, districtsHere, dataForFeature]);

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
    const values: number[] = [];
    const facCounts: number[] = [];
    if (level === 'nation') {
      for (const s of stateRatings) {
        const v = valueOfState(s);
        if (v !== null && Number.isFinite(v)) values.push(v);
        facCounts.push(s.facilities);
      }
    } else {
      for (const td of topoDistrictsHere) {
        const v = valueOfDistrict(td.primary);
        if (v !== null && Number.isFinite(v)) values.push(v);
        facCounts.push(td.facilities);
      }
    }

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

    const facMax = Math.max(1, ...facCounts);
    const dfac = logScale ? logT(facMax) : facMax;
    const sq = scaleSqrt().domain([0, dfac]).range([3, 26]);
    const sizeFn = (f: number) => sq(logScale ? logT(f) : f);
    return { colorOf: color, sizeOf: sizeFn };
  }, [level, stateRatings, topoDistrictsHere, isRate, ramp, logScale, valueOfState, valueOfDistrict]);

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

  // ── attach d3.zoom once the <svg> mounts ────────────────────────────────────
  // The transform is applied DIRECTLY to the <g> DOM node here — never through
  // React state — so panning/zooming is a single attribute write per frame
  // instead of a full re-render of every state/district path. Only `zoomK` is
  // lifted into React, and only when it changes by a meaningful step.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || zoomRef.current) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, MAX_K])
      .clickDistance(6)
      .on('zoom', (e: D3ZoomEvent<SVGSVGElement, unknown>) => {
        // Write pan/zoom as a CSS transform (not the SVG `transform` attribute)
        // so the browser can scale a cached raster of the heavy ~270k-point
        // basemap during the gesture instead of re-rasterising every vector
        // point per frame. transform-origin 0 0 (set on the <g>) matches d3's
        // matrix convention: translate, then scale about the top-left.
        const t = e.transform;
        if (gRef.current) gRef.current.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
        const k = e.transform.k;
        // Coarse-step the React-visible scale: re-cluster/re-size pins only when
        // the zoom changes by >8%, so a smooth wheel doesn't re-render per frame.
        setZoomK((prev) => (Math.abs(k - prev) > prev * 0.08 ? k : prev));
      });
    zoomRef.current = z;
    select(svg).call(z).on('dblclick.zoom', null);
  }, [size.width, size.height]);

  // ── animated fly-to via native d3-transition (van-Wijk smooth zoom) ──────────
  const animateZoomTo = useCallback((target: ZoomTransform, duration = 750) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    const sel = select(svg);
    if (duration <= 0) {
      sel.call(z.transform, target);
      return;
    }
    sel.transition().duration(duration).call(z.transform, target);
  }, []);

  // Observable "zoom to bounding box" helper.
  // Computes a zoom transform that fits the provided bounds into the viewport,
  // with padding, then animates via the configured d3-zoom behavior.
  const zoomToBounds = useCallback(
    (b: [[number, number], [number, number]], pad = 0.9, duration = 750) => {
      if (!size.width || !size.height) return;
      const [[x0, y0], [x1, y1]] = b;
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx <= 0 || dy <= 0) return;

      const k = Math.min(MAX_K, pad / Math.max(dx / size.width, dy / size.height));
      const kk = Math.max(1, k);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;

      animateZoomTo(zoomIdentity.translate(size.width / 2, size.height / 2).scale(kk).translate(-cx, -cy), duration);
    },
    [animateZoomTo, size.height, size.width],
  );

  // ── smooth zoom-to-bounds on drill ──────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z || !path || !projection || !size.width) return;

    const apply = (k: number, cx: number, cy: number) =>
      animateZoomTo(zoomIdentity.translate(size.width / 2, size.height / 2).scale(k).translate(-cx, -cy));

    if (selectedFacilityId) {
      const f = facilities.find((x) => x.facilityId === selectedFacilityId);
      if (f && f.lat != null && f.lon != null) {
        const [cx, cy] = projection([f.lon, f.lat]) as [number, number];
        apply(Math.min(MAX_K, 28), cx, cy);
        return;
      }
    }

    if (level === 'nation') {
      animateZoomTo(zoomIdentity);
      return;
    }
    if (level === 'state' && selectedState) {
      const f = statesFC.features.find((x) => normName(x.properties.st_nm) === normName(selectedState));
      if (f) zoomToBounds(path.bounds(f), 0.9);
      return;
    }
    if (level === 'district' && selectedDistrict) {
      if (selectedDistrictFeature) {
        zoomToBounds(path.bounds(selectedDistrictFeature), 0.8);
      } else {
        const dr = districtRatings.find((d) => d.district === selectedDistrict && d.state === selectedState);
        if (dr && dr.lat != null && dr.lon != null) {
          const [cx, cy] = projection([dr.lon, dr.lat]) as [number, number];
          apply(20, cx, cy);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, selectedState, selectedDistrict, selectedFacilityId, selectedDistrictFeature, facilities, path, projection, size.width, size.height, animateZoomTo, zoomToBounds]);

  // ── manual zoom controls (in / out / reset) ────────────────────────────────
  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const cur = zoomTransform(svg);
    const nk = Math.max(1, Math.min(MAX_K, cur.k * factor));
    const cx = size.width / 2;
    const cy = size.height / 2;
    const nx = cx - ((cx - cur.x) * nk) / cur.k;
    const ny = cy - ((cy - cur.y) * nk) / cur.k;
    animateZoomTo(zoomIdentity.translate(nx, ny).scale(nk), 250);
  };
  const resetZoom = () => animateZoomTo(zoomIdentity, 400);

  // ── facility clustering (state & district levels) ───────────────────────────
  // Clusters in PROJECTED (data) space using a distance threshold of
  // CLUSTER_PX / k, so the grouping is translation-invariant (pan never re-runs
  // it) and breaks apart automatically as you zoom in. Recomputes only on the
  // coarse `zoomK` steps.
  const clusters = useMemo(() => {
    if (level === 'nation' || display === 'bubble' || !projection) return [];
    const pts = facilities
      .filter((f) => f.lat != null && f.lon != null)
      .map((f) => {
        const [x, y] = projection([f.lon as number, f.lat as number]) as [number, number];
        return { f, x, y };
      });
    const threshold = CLUSTER_PX / zoomK;
    const out: { x: number; y: number; items: typeof pts }[] = [];
    for (const p of pts) {
      let best: (typeof out)[number] | null = null;
      let bestD = threshold;
      for (const c of out) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best) {
        const n = best.items.length;
        best.x = (best.x * n + p.x) / (n + 1);
        best.y = (best.y * n + p.y) / (n + 1);
        best.items.push(p);
      } else {
        out.push({ x: p.x, y: p.y, items: [p] });
      }
    }
    return out;
  }, [facilities, projection, level, display, zoomK]);

  // ── geography centroid clustering (states at nation, districts at state) ─────
  // Gives a "ping" layer for geography itself, so users can read hotspots even
  // before focusing individual facilities.
  const geographyClusters = useMemo(() => {
    if (!projection || level === 'district') return [] as {
      x: number;
      y: number;
      items: { state?: StateRating; district?: TopoDistrict }[];
    }[];

    const pts: { x: number; y: number; state?: StateRating; district?: TopoDistrict }[] =
      level === 'nation'
        ? stateRatings
            .map((s) => {
              const c = stateCentroids.get(normName(s.state));
              return c ? { x: c[0], y: c[1], state: s } : null;
            })
            .filter((p): p is { x: number; y: number; state: StateRating } => p !== null)
        : topoDistrictsHere
            .filter((d) => d.primary.lat != null && d.primary.lon != null)
            .map((d) => {
              const [x, y] = projection([d.primary.lon as number, d.primary.lat as number]) as [number, number];
              return { x, y, district: d };
            });

    const threshold = GEO_CLUSTER_PX / zoomK;
    const out: { x: number; y: number; items: { state?: StateRating; district?: TopoDistrict }[] }[] = [];
    for (const p of pts) {
      let best: (typeof out)[number] | null = null;
      let bestD = threshold;
      for (const c of out) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best) {
        const n = best.items.length;
        best.x = (best.x * n + p.x) / (n + 1);
        best.y = (best.y * n + p.y) / (n + 1);
        best.items.push({ state: p.state, district: p.district });
      } else {
        out.push({ x: p.x, y: p.y, items: [{ state: p.state, district: p.district }] });
      }
    }
    return out;
  }, [projection, level, stateRatings, stateCentroids, topoDistrictsHere, zoomK]);

  // ── static (zoom-independent) layers ────────────────────────────────────────
  // Memoised so that a `zoomK` step (which only the bubbles/clusters/pins care
  // about) reuses this element tree and React skips reconciling the ~780
  // state/district paths — that's what keeps the fly-to animation smooth.
  const staticLayers = useMemo(() => {
    if (!path) return null;
    return (
      <>
        {/* ── world-countries backdrop (context); fades away as you drill in ── */}
        {worldFC && (
          <g pointerEvents="none" style={{ opacity: level === 'nation' ? 1 : 0, transition: 'opacity 600ms ease' }}>
            {worldFC.features.map((f) => (
              <path
                key={`wc-${(f.properties?.name as string) ?? (f.properties?.iso as string)}`}
                d={path(f) ?? undefined}
                fill="#dce5ef"
                stroke="#cbd5e1"
                strokeWidth={0.4}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )}

        {/* ── India nation outline: soft halo under the states (floating landmass) ── */}
        {nationFC?.features.map((f) => (
          <path
            key="nation-outline"
            d={path(f) ?? undefined}
            fill="#ffffff"
            stroke="#64748b"
            strokeWidth={1.1}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            style={{ filter: level === 'nation' ? 'drop-shadow(0 2px 3px rgba(15,23,42,0.18))' : 'none' }}
          />
        ))}

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
                emitHover(
                  r
                    ? { kind: 'state', name: r.state, sub: `${r.facilities} facilities`, rating: r }
                    : { kind: 'state', name: f.properties.st_nm, sub: 'No surveyed facilities' },
                )
              }
              onMouseLeave={() => emitHover(null)}
              onClick={() => level === 'nation' && r && onSelectState(r.state)}
            />
          );
        })}

        <path d={path(statesMesh) ?? undefined} fill="none" stroke="#cbd5e1" strokeWidth={0.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />

        {/* ── district polygons of the selected state (fade in on drill) ── */}
        {level !== 'nation' && (
          <g key={`dl-${selectedStateNorm}`} className="dd-fade">
            {districtsHere.map((f) => {
              const td = dataForFeature(f);
              // Every district boundary is drillable — data districts select by
              // their reconciled rating name, data-less ones by the boundary name.
              const boundaryName = titleCase(f.properties.district);
              const isSelDist = td
                ? td.primary.district === selectedDistrict
                : selectedDistrict != null && normName(f.properties.district) === normName(selectedDistrict);
              const shaded = display === 'shade';
              return (
                <path
                  key={`dt-${f.properties.st_nm}-${f.properties.district}`}
                  d={path(f) ?? undefined}
                  fill={shaded ? colorOf(td ? valueOfDistrict(td.primary) : null) : 'none'}
                  fillOpacity={shaded ? (td ? 0.92 : 0.35) : 0}
                  stroke={isSelDist ? '#0f172a' : '#cbd5e1'}
                  strokeWidth={isSelDist ? 1.2 : 0.5}
                  strokeDasharray={shaded ? undefined : '2 2'}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() =>
                    emitHover(
                      td
                        ? {
                            kind: 'district',
                            name: td.primary.district,
                            sub: `${td.primary.state} · ${td.facilities} facilities`,
                            rating: td.primary,
                          }
                        : { kind: 'district', name: boundaryName, sub: 'No surveyed facilities' },
                    )
                  }
                  onMouseLeave={() => emitHover(null)}
                  onClick={() => onSelectDistrict(td ? td.primary.district : boundaryName)}
                  pointerEvents="auto"
                />
              );
            })}
          </g>
        )}
      </>
    );
  }, [
    path,
    worldFC,
    nationFC,
    statesFC,
    statesMesh,
    districtsHere,
    stateByNorm,
    selectedStateNorm,
    selectedDistrict,
    level,
    display,
    colorOf,
    valueOfState,
    valueOfDistrict,
    dataForFeature,
    emitHover,
    onSelectState,
    onSelectDistrict,
  ]);

  // Signal parent once the first paintable frame is ready.
  useEffect(() => {
    if (!path) return;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => onReady?.());
    });
    return () => cancelAnimationFrame(id);
  }, [path, level, selectedState, selectedDistrict, onReady]);

  const k = zoomK;
  if (!path || !projection) return <div ref={containerRef} className="h-full w-full" />;

  const districtPings =
    level === 'nation' ? [] : topoDistrictsHere.filter((d) => d.primary.lat != null && d.primary.lon != null);

  // Dominant trust signal of a cluster's members → cluster fill.
  const clusterSignal = (items: { f: FacilityRanking }[]) => {
    const tally: Record<string, number> = {};
    for (const { f } of items) {
      const s = f.overrideSignal ?? f.trustSignal;
      tally[s] = (tally[s] ?? 0) + 1;
    }
    return (Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'no_claim') as keyof typeof SIGNAL_COLORS;
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-xl border bg-[#eef4fb]">
      <style>{`@keyframes ddFadeIn{from{opacity:0}to{opacity:1}}.dd-fade{animation:ddFadeIn 450ms ease-out both}@keyframes ddPing{0%{transform:scale(0.72);opacity:.42}70%{opacity:.12}100%{transform:scale(1.32);opacity:0}}.dd-ping{animation:ddPing 1.9s ease-out infinite;transform-origin:center;}`}</style>
      <svg ref={svgRef} width={size.width} height={size.height} className="block touch-none">
        <g ref={gRef} style={{ transformOrigin: '0 0', willChange: 'transform' }}>
          {staticLayers}

          {/* ── clustered geography pings (state/district centroids) ── */}
          {geographyClusters.map((c, i) => {
            const n = c.items.length;
            const baseR = Math.min(17, 7 + Math.sqrt(n) * 1.8) / k;
            const first = c.items[0];
            const label =
              n > 1
                ? `${n} geographies`
                : first.state
                  ? first.state.state
                  : first.district?.primary.district ?? 'Geography';
            return (
              <g
                key={`geo-cl-${i}`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() =>
                  emitHover(
                    n > 1
                      ? { kind: level === 'nation' ? 'state' : 'district', name: label, sub: 'Zoom in to split clusters' }
                      : first.state
                        ? { kind: 'state', name: first.state.state, sub: `${first.state.facilities} facilities`, rating: first.state }
                        : first.district
                          ? {
                              kind: 'district',
                              name: first.district.primary.district,
                              sub: `${first.district.primary.state} · ${first.district.facilities} facilities`,
                              rating: first.district.primary,
                            }
                          : { kind: level === 'nation' ? 'state' : 'district', name: label },
                  )
                }
                onMouseLeave={() => emitHover(null)}
                onClick={() => {
                  if (n > 1) {
                    // When the ping represents multiple geographies, zoom to the
                    // extent of the member centroids (observable-style bounds fit)
                    // instead of an arbitrary scale factor.
                    const memberPoints: [number, number][] =
                      level === 'nation'
                        ? c.items
                            .map((it) =>
                              it.state ? stateCentroids.get(normName(it.state.state)) : null,
                            )
                            .filter((p): p is [number, number] => p != null)
                        : c.items
                            .map((it) => {
                              if (!it.district?.primary || it.district.primary.lat == null || it.district.primary.lon == null) return null;
                              return projection([it.district.primary.lon, it.district.primary.lat]) as [number, number];
                            })
                            .filter((p): p is [number, number] => p != null);

                    if (memberPoints.length >= 2) {
                      const minX = Math.min(...memberPoints.map((p) => p[0]));
                      const maxX = Math.max(...memberPoints.map((p) => p[0]));
                      const minY = Math.min(...memberPoints.map((p) => p[1]));
                      const maxY = Math.max(...memberPoints.map((p) => p[1]));
                      zoomToBounds([[minX, minY], [maxX, maxY]], 0.9, 500);
                    } else {
                      const next = Math.min(MAX_K, k * 1.9);
                      animateZoomTo(
                        zoomIdentity
                          .translate(size.width / 2, size.height / 2)
                          .scale(next)
                          .translate(-c.x, -c.y),
                        500,
                      );
                    }
                    return;
                  }
                  if (first.state) onSelectState(first.state.state);
                  else if (first.district) onSelectDistrict(first.district.primary.district);
                }}
              >
                <circle className="dd-ping" cx={c.x} cy={c.y} r={baseR * 2.35} fill="#0ea5e9" fillOpacity={0.25} />
                <circle cx={c.x} cy={c.y} r={baseR} fill="#0284c7" fillOpacity={0.88} stroke="#ffffff" strokeWidth={1.3 / k} />
                {n > 1 && (
                  <text
                    x={c.x}
                    y={c.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.min(12, 8 + Math.sqrt(n)) / k}
                    fontWeight={700}
                    fill="#ffffff"
                    pointerEvents="none"
                  >
                    {n}
                  </text>
                )}
                {n === 1 && (
                  <text
                    x={c.x + (baseR + 6) / k}
                    y={c.y}
                    textAnchor="start"
                    dominantBaseline="central"
                    fontSize={11 / k}
                    fontWeight={700}
                    fill="#0f172a"
                    pointerEvents="none"
                    style={{ paintOrder: 'stroke', stroke: 'rgba(255,255,255,0.9)', strokeWidth: 3 / k }}
                  >
                    {label}
                  </text>
                )}
              </g>
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
                  onMouseEnter={() => emitHover({ kind: 'state', name: s.state, sub: `${s.facilities} facilities`, rating: s })}
                  onMouseLeave={() => emitHover(null)}
                  onClick={() => onSelectState(s.state)}
                />
              );
            })}

          {/* ── bubble mode: district centroids (state) ── */}
          {level !== 'nation' &&
            display === 'bubble' &&
            districtPings.map((d) => {
              const [cx, cy] = projection([d.primary.lon as number, d.primary.lat as number]) as [number, number];
              const isSel = d.primary.district === selectedDistrict;
              return (
                <circle
                  key={`db-${d.key}`}
                  cx={cx}
                  cy={cy}
                  r={sizeOf(d.facilities) / k}
                  fill={colorOf(valueOfDistrict(d.primary))}
                  fillOpacity={0.78}
                  stroke={isSel ? '#0f172a' : '#1e293b'}
                  strokeWidth={(isSel ? 2 : 0.8) / k}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => emitHover({ kind: 'district', name: d.primary.district, sub: `${d.primary.state} · ${d.facilities} facilities`, rating: d.primary })}
                  onMouseLeave={() => emitHover(null)}
                  onClick={() => onSelectDistrict(d.primary.district)}
                />
              );
            })}

          {/* ── facility pins, clustered (state & district levels; fade in on drill) ── */}
          {showPins && level !== 'nation' && display === 'shade' && (
            <g key={`fl-${selectedState}-${selectedDistrict}`} className="dd-fade">
              {clusters.map((c, i) => {
                // Singleton → individual pin (with full hover/select behaviour).
                if (c.items.length === 1) {
                  const { f, x, y } = c.items[0];
                  const isHover = f.facilityId === hoveredFacilityId;
                  const isSel = f.facilityId === selectedFacilityId;
                  const sig = f.overrideSignal ?? f.trustSignal;
                  const r = (isSel ? 7 : isHover ? 6 : 4.5) / k;
                  const showLabel = k >= 3 || level === 'district';
                  const label = f.name.length > 22 ? `${f.name.slice(0, 20)}…` : f.name;
                  return (
                    <g key={`fp-${f.facilityId}`}>
                      <circle
                        cx={x}
                        cy={y}
                        r={r}
                        fill={SIGNAL_COLORS[sig]}
                        fillOpacity={0.9}
                        stroke={isSel ? '#0f172a' : '#ffffff'}
                        strokeWidth={(isSel ? 2 : 1) / k}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => emitHover({ kind: 'facility', name: f.name, sub: `${f.district}, ${f.state}`, facility: f })}
                        onMouseLeave={() => emitHover(null)}
                        onClick={() => onSelectFacility(f)}
                      />
                      {showLabel && (
                        <text
                          x={x + (r + 5) / k}
                          y={y}
                          textAnchor="start"
                          dominantBaseline="central"
                          fontSize={10 / k}
                          fontWeight={600}
                          fill="#0f172a"
                          pointerEvents="none"
                          style={{ paintOrder: 'stroke', stroke: 'rgba(255,255,255,0.92)', strokeWidth: 3 / k }}
                        >
                          {label}
                        </text>
                      )}
                    </g>
                  );
                }
                // Cluster bubble → count + dominant signal; click zooms in to split it.
                const n = c.items.length;
                const sig = clusterSignal(c.items);
                const rr = Math.min(22, 9 + Math.sqrt(n) * 2) / k;
                return (
                  <g
                    key={`cl-${i}`}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() =>
                      emitHover({ kind: 'facility', name: `${n} facilities`, sub: 'Zoom in to separate', facility: c.items[0].f })
                    }
                    onMouseLeave={() => emitHover(null)}
                    onClick={() => {
                      const memberPoints = c.items
                        .map(({ x, y }) => [x, y] as [number, number])
                        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
                      if (memberPoints.length >= 2) {
                        const minX = Math.min(...memberPoints.map((p) => p[0]));
                        const maxX = Math.max(...memberPoints.map((p) => p[0]));
                        const minY = Math.min(...memberPoints.map((p) => p[1]));
                        const maxY = Math.max(...memberPoints.map((p) => p[1]));
                        zoomToBounds([[minX, minY], [maxX, maxY]], 0.86, 500);
                        return;
                      }
                      const next = Math.min(MAX_K, k * 2.4);
                      animateZoomTo(zoomIdentity.translate(size.width / 2, size.height / 2).scale(next).translate(-c.x, -c.y), 500);
                    }}
                  >
                    <circle cx={c.x} cy={c.y} r={rr * 1.55} fill={SIGNAL_COLORS[sig]} fillOpacity={0.2} />
                    <circle cx={c.x} cy={c.y} r={rr} fill={SIGNAL_COLORS[sig]} fillOpacity={0.85} stroke="#ffffff" strokeWidth={1.5 / k} />
                    <text
                      x={c.x}
                      y={c.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={Math.min(13, 8 + Math.sqrt(n)) / k}
                      fontWeight={700}
                      fill="#ffffff"
                      pointerEvents="none"
                    >
                      {n}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
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
