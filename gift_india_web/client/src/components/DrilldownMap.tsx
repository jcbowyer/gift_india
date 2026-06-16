import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath, type GeoProjection } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition'; // augments selection.prototype with .transition() (used for fly-to)
import { easeCubicInOut } from 'd3-ease';
import { zoom as d3zoom, zoomIdentity, zoomTransform, type ZoomBehavior, type D3ZoomEvent, ZoomTransform } from 'd3-zoom';
import { scaleLinear } from 'd3-scale';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { FacilityRanking, StateRating, DistrictRating } from '../lib/api';
import { effectiveTrustSignal, humanReviewStatusForRanking } from '../lib/api';
import { SIGNAL_COLORS, normName, titleCase, placeMatch, resolveBoundaryState, resolveBoundaryDistrict, facilityBubbleCap, facilityBubbleRadius } from '../lib/mapPalette';
import { DistrictLocator, districtKey, districtsForState } from '../lib/geoAssign';

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
  /** Full selected facility (search / list) — used for zoom even when not in the paged results. */
  selectedFacility?: FacilityRanking | null;
  display: MapDisplay;
  showPins?: boolean;
  logScale: boolean;
  ramp: string[]; // low → high colour stops for the active metric
  /** Min/max of the active metric within the current map scope (drives shading + legend). */
  colorDomain: [number, number] | null;
  valueOfState: (s: StateRating) => number | null;
  valueOfDistrict: (d: DistrictRating) => number | null;
  onSelectState: (dataState: string | null) => void;
  onSelectDistrict: (dataDistrict: string | null) => void;
  onSelectFacility: (f: FacilityRanking | null) => void;
  onHover: (h: HoverInfo | null) => void;
  districtTopology?: Topology | null;
  /** False while a per-state district layer is still loading (all-India drill). */
  districtLayersReady?: boolean;
  /** Padding for fit/zoom so features center in the visible map area (not under overlays). */
  viewportInset?: ViewportInset;
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
/** Regions with no metric value for the active capability — distinct from the white nation halo. */
const NO_DATA_FILL = '#b8c6d6';
const EMPTY = NO_DATA_FILL;
const STATE_BORDER = '#334155';
const STATE_BORDER_WIDTH = 1;
const STATE_MESH_STROKE = '#475569';
const STATE_MESH_WIDTH = 0.85;
const CLUSTER_PX = 46; // screen-space radius at which nearby pins collapse into a cluster
const GEO_CLUSTER_PX = 54; // geography centroid clustering threshold
const DRILL_ZOOM_MS = 750;
const CLUSTER_ZOOM_MS = 120;
/** Fan out up to this many facilities in one click (spider ring). */
const SPIDER_MAX_FACILITIES = 40;
/** Below this projected spread (px), facilities are treated as co-located and fanned on a ring. */
const COLOCATED_EPS = 5;

/** How tightly drill-down fits a bounding box (higher fill = less margin / whitespace). */
const ZOOM_FIT = {
  nation: { fill: 1.38, maxK: 6 },
  state: { fill: 1.08, maxK: 28 },
  district: { fill: 1.04, maxK: 40 },
  facility: { fill: 1.02, maxK: MAX_K },
  cluster: { fill: 1.0, maxK: MAX_K },
} as const;

export interface ViewportInset {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

function viewportMetrics(
  size: { width: number; height: number },
  inset: ViewportInset,
) {
  const left = inset.left ?? 0;
  const right = inset.right ?? 0;
  const top = inset.top ?? 0;
  const bottom = inset.bottom ?? 0;
  const width = Math.max(1, size.width - left - right);
  const height = Math.max(1, size.height - top - bottom);
  return {
    left,
    right,
    top,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    extent: [[left, top], [size.width - right, size.height - bottom]] as [[number, number], [number, number]],
  };
}

function indiaBounds(
  path: ReturnType<typeof geoPath>,
  nationFC: FeatureCollection | null,
  statesFC: FeatureCollection<Geometry, StateProps>,
): [[number, number], [number, number]] | null {
  if (nationFC?.features[0]) return path.bounds(nationFC.features[0]);
  if (statesFC.features.length) return path.bounds(statesFC);
  return null;
}

type BBox = [[number, number], [number, number]];

function expandBounds(b: BBox, padFraction = 0.1): BBox {
  const [[x0, y0], [x1, y1]] = b;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const px = dx * padFraction;
  const py = dy * padFraction;
  return [[x0 - px, y0 - py], [x1 + px, y1 + py]];
}

function boundsFromProjectedPoints(points: { x: number; y: number }[]): BBox | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

/** Prefer facility locations when available — district polygons are often much larger than pin spread. */
function districtDrillBounds(polygonBounds: BBox | null, facilityBounds: BBox | null): BBox | null {
  if (facilityBounds) return expandBounds(facilityBounds, 0.06);
  if (polygonBounds) return expandBounds(polygonBounds, 0.03);
  return null;
}

function bboxSignature(b: BBox | null): string {
  if (!b) return '0';
  return `${b[0][0].toFixed(0)}:${b[0][1].toFixed(0)}:${b[1][0].toFixed(0)}:${b[1][1].toFixed(0)}`;
}

type ViewportSize = { width: number; height: number };

function inflateBoundsToMinSpan(b: BBox, viewport: ViewportSize, fill: number, maxK: number): BBox {
  let [[x0, y0], [x1, y1]] = b;
  let dx = x1 - x0;
  let dy = y1 - y0;
  const minDx = (viewport.width * fill) / maxK;
  const minDy = (viewport.height * fill) / maxK;
  if (dx < minDx) {
    const cx = (x0 + x1) / 2;
    x0 = cx - minDx / 2;
    x1 = cx + minDx / 2;
  }
  if (dy < minDy) {
    const cy = (y0 + y1) / 2;
    y0 = cy - minDy / 2;
    y1 = cy + minDy / 2;
  }
  return [[x0, y0], [x1, y1]];
}

/** Scale factor that fits `b` into the viewport (fill > 1 crops margin). */
function computeFitScale(
  b: BBox,
  viewport: ViewportSize,
  opts: { fill?: number; maxK?: number; minK?: number } = {},
): number {
  const { fill = 1, maxK = MAX_K, minK = 1 } = opts;
  const [[x0, y0], [x1, y1]] = inflateBoundsToMinSpan(b, viewport, fill, maxK);
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return minK;
  const kFit = fill / Math.max(dx / viewport.width, dy / viewport.height);
  return Math.max(minK, Math.min(maxK, kFit));
}

type FacilityPoint = { f: FacilityRanking; x: number; y: number };

type SpiderLayout =
  | { mode: 'ring'; cx: number; cy: number; items: FacilityPoint[] }
  | { mode: 'geo'; items: FacilityPoint[] };

type ZoomFitOpts = { fill?: number; maxK?: number; minK?: number; duration?: number };
const logT = (v: number) => Math.log10(v + 1);

type GeoClusterItem = { state?: StateRating; district?: TopoDistrict };

/** Total facility count for a geography cluster badge label. */
function clusterFacilityCount(items: GeoClusterItem[]): number {
  let sum = 0;
  for (const it of items) {
    const r = it.state ?? it.district?.primary;
    if (r) sum += r.facilities;
  }
  return sum;
}

function formatClusterLabel(value: number): string {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded) || rounded <= 0) return '0';
  return rounded >= 10_000 ? `${Math.round(rounded / 1000)}k` : String(rounded);
}

/** SVG user units for a desired on-screen pixel size at zoom scale k. */
function screenPx(k: number, px: number): number {
  return px / k;
}

/** Readable badge label size — scaled to fit inside the badge, not the raw count magnitude. */
function clusterLabelFontPx(value: number, radiusPx: number): number {
  const label = formatClusterLabel(value);
  const digits = label.length;
  const fit = radiusPx * (digits >= 4 ? 0.52 : digits === 3 ? 0.6 : 0.72);
  return Math.min(18, Math.max(13, fit));
}

/** Badge radius from the displayed count (log-scaled so 2k+ totals stay compact). */
function clusterBadgeRadiusPx(labelValue: number, memberCount = 1): number {
  const label = formatClusterLabel(labelValue);
  const digits = label.length;
  const logMag = Math.log10(Math.max(labelValue, 1) + 1);
  return Math.min(
    24,
    10 + Math.sqrt(memberCount) * 1.2 + logMag * 2.2 + Math.max(0, digits - 2) * 1.2,
  );
}

function applyZoomTransform(g: SVGGElement | null, t: ZoomTransform) {
  if (!g) return;
  g.setAttribute('transform', t.toString());
}

function findStateFeature(
  selectedState: string,
  states: Feature<Geometry, StateProps>[],
): Feature<Geometry, StateProps> | null {
  return (
    states.find(
      (x) =>
        normName(x.properties.st_nm) === normName(selectedState) ||
        placeMatch(x.properties.st_nm, selectedState),
    ) ?? null
  );
}

/** Pin + label with a generous hit target so label clicks select the facility (not the district underlay). */
function FacilityPin({
  f,
  x,
  y,
  k,
  isSel,
  isHover,
  showLabel,
  onSelect,
  onHoverEnter,
  onHoverLeave,
  highlight = false,
}: {
  f: FacilityRanking;
  x: number;
  y: number;
  k: number;
  isSel: boolean;
  isHover: boolean;
  showLabel: boolean;
  onSelect: (f: FacilityRanking) => void;
  onHoverEnter: (f: FacilityRanking) => void;
  onHoverLeave: () => void;
  highlight?: boolean;
}) {
  const sig = effectiveTrustSignal(f);
  const needsReview = humanReviewStatusForRanking(f).recommended;
  const r = (highlight ? 7 : isSel ? 7 : isHover ? 6 : 4.5) / k;
  const hitR = 16 / k;
  const label = f.name.length > (highlight ? 24 : 22) ? `${f.name.slice(0, highlight ? 22 : 20)}…` : f.name;
  const labelX = x + (r + 5) / k;
  const labelW = Math.max(48, label.length * 5.8) / k;
  const labelH = 16 / k;

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(f);
      }}
      onMouseEnter={() => onHoverEnter(f)}
      onMouseLeave={onHoverLeave}
    >
      <circle cx={x} cy={y} r={hitR} fill="transparent" />
      {highlight && (
        <circle cx={x} cy={y} r={10 / k} fill="none" stroke="#0f172a" strokeWidth={2 / k} pointerEvents="none" />
      )}
      {needsReview && (
        <circle
          cx={x}
          cy={y}
          r={(r + 3.5) / k}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={1.75 / k}
          strokeDasharray={`${4 / k} ${2 / k}`}
          pointerEvents="none"
        />
      )}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={SIGNAL_COLORS[sig]}
        fillOpacity={highlight ? 0.95 : 0.9}
        stroke={isSel || highlight ? '#0f172a' : '#ffffff'}
        strokeWidth={(isSel || highlight ? 2 : 1) / k}
        pointerEvents="none"
      />
      {showLabel && (
        <>
          <rect
            x={labelX - 2 / k}
            y={y - labelH / 2}
            width={labelW}
            height={labelH}
            fill="transparent"
          />
          <text
            x={labelX}
            y={y}
            textAnchor="start"
            dominantBaseline="central"
            fontSize={(highlight ? 11 : 10) / k}
            fontWeight={highlight ? 700 : 600}
            fill="#0f172a"
            pointerEvents="none"
            style={{ paintOrder: 'stroke', stroke: 'rgba(255,255,255,0.92)', strokeWidth: 3 / k }}
          >
            {label}
          </text>
        </>
      )}
    </g>
  );
}

export function DrilldownMap({
  topology,
  worldTopology: _worldTopology,
  stateRatings,
  districtRatings,
  facilities,
  selectedState,
  selectedDistrict,
  hoveredFacilityId,
  selectedFacilityId,
  selectedFacility = null,
  display,
  showPins = true,
  logScale,
  ramp,
  colorDomain,
  valueOfState,
  valueOfDistrict,
  onSelectState,
  onSelectDistrict,
  onSelectFacility,
  onHover,
  districtTopology = null,
  districtLayersReady = true,
  viewportInset = { top: 8, right: 8, bottom: 72, left: 8 },
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
  const [spider, setSpider] = useState<SpiderLayout | null>(null);
  /** At district (or when toggled) show every hospital pin — skip slow cluster zoom. */
  const [expandHospitals, setExpandHospitals] = useState(false);

  const level: MapLevel = selectedDistrict ? 'district' : selectedState ? 'state' : 'nation';
  /** Facility pins only at district, or state after "Hospitals" — never stacked on district summary bubbles. */
  const showFacilityPins = showPins && (level === 'district' || (level === 'state' && expandHospitals));
  const selectedStateNorm = selectedState ? normName(selectedState) : null;
  const viewport = useMemo(
    () => viewportMetrics(size, viewportInset),
    [size, viewportInset],
  );

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

  // Clear spider + auto-expand hospitals when drilling to district or focusing a facility.
  useEffect(() => {
    setSpider(null);
    setExpandHospitals(Boolean(selectedDistrict || selectedFacilityId));
  }, [selectedState, selectedDistrict, selectedFacilityId]);

  // ── topo features (states always; districts deferred until a state is selected) ─
  const statesObj = topology.objects.states as GeometryCollection | undefined;
  const { statesFC, statesMesh } = useMemo(() => {
    const emptyFC = { type: 'FeatureCollection', features: [] } as FeatureCollection<Geometry, StateProps>;
    if (!statesObj?.geometries?.length) {
      return { statesFC: emptyFC, statesMesh: null as ReturnType<typeof mesh> | null };
    }
    const sfc = feature(topology, statesObj) as FeatureCollection<Geometry, StateProps>;
    const smesh = mesh(topology, statesObj, (a, b) => a !== b);
    return { statesFC: sfc, statesMesh: smesh };
  }, [topology, statesObj]);

  const districtsByState = useMemo(() => {
    if (!selectedStateNorm || !districtTopology) return new Map<string, Feature<Geometry, DistrictProps>[]>();
    const dfc = feature(
      districtTopology,
      districtsForState(districtTopology, selectedStateNorm),
    ) as FeatureCollection<Geometry, DistrictProps>;
    const byState = new Map<string, Feature<Geometry, DistrictProps>[]>();
    for (const f of dfc.features) {
      const k = normName(f.properties.st_nm);
      (byState.get(k) ?? byState.set(k, []).get(k)!).push(f);
    }
    return byState;
  }, [districtTopology, selectedStateNorm]);

  const locator = useMemo(
    () => (selectedStateNorm && districtTopology ? new DistrictLocator(districtTopology, selectedStateNorm) : null),
    [districtTopology, selectedStateNorm],
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

  const fitExtent = viewport.extent;

  // ── projection fitted to India ─────────────────────────────────────────────
  const projection = useMemo<GeoProjection | null>(() => {
    if (!size.width || !size.height) return null;
    const fitTarget =
      statesFC.features.length > 0
        ? statesFC
        : nationFC && nationFC.features.length > 0
          ? nationFC
          : null;
    if (!fitTarget) return null;
    return geoMercator().fitExtent(fitExtent, fitTarget);
  }, [size.width, size.height, statesFC, nationFC, fitExtent]);
  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  const stateCentroids = useMemo(() => {
    const m = new Map<string, [number, number]>();
    if (path) for (const f of statesFC.features) m.set(normName(f.properties.st_nm), path.centroid(f));
    return m;
  }, [path, statesFC]);

  // ── metric value → colour + facility-count → bubble size (per level) ────────
  const { colorOf, sizeOf } = useMemo(() => {
    const facCounts: number[] = [];
    if (level === 'nation') {
      for (const s of stateRatings) facCounts.push(s.facilities);
    } else {
      for (const d of districtRatings) facCounts.push(d.facilities);
    }
    const facCap = facilityBubbleCap(facCounts);

    let color: (v: number | null) => string;
    const [rawLo, rawHi] = colorDomain ?? [0, 1];
    const lo = logScale ? logT(rawLo) : rawLo;
    const hi = logScale ? logT(rawHi) : rawHi;
    if (hi <= lo) {
      const mid = ramp[Math.floor(ramp.length / 2)] ?? ramp[ramp.length - 1];
      color = (v) => (v === null || !Number.isFinite(v) ? EMPTY : mid);
    } else {
      const stops = ramp.map((_, i) => lo + ((hi - lo) * i) / (ramp.length - 1));
      const s = scaleLinear<string>().domain(stops).range(ramp).clamp(true);
      color = (v) => (v === null || !Number.isFinite(v) ? EMPTY : s(logScale ? logT(v) : v));
    }

    const sizeFn = (f: number) => facilityBubbleRadius(f, facCap);
    return { colorOf: color, sizeOf: sizeFn };
  }, [level, stateRatings, districtRatings, ramp, logScale, colorDomain]);

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
  // Apply d3's zoom matrix as an SVG transform on <g> so pan/zoom stays aligned
  // with path.bounds() / projection coordinates (CSS transforms on <g> mis-center).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || zoomRef.current) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, MAX_K])
      .clickDistance(6)
      .on('zoom', (e: D3ZoomEvent<SVGSVGElement, unknown>) => {
        applyZoomTransform(gRef.current, e.transform);
        const k = e.transform.k;
        setZoomK((prev) => (Math.abs(k - prev) > prev * 0.14 ? k : prev));
      });
    zoomRef.current = z;
    select(svg).call(z).on('dblclick.zoom', null);
    applyZoomTransform(gRef.current, zoomIdentity);
  }, [size.width, size.height]);

  // ── animated fly-to via native d3-transition (van-Wijk smooth zoom) ──────────
  const animateZoomTo = useCallback((target: ZoomTransform, duration = DRILL_ZOOM_MS) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    const sel = select(svg);
    sel.interrupt();
    if (duration <= 0) {
      sel.call(z.transform, target);
      return;
    }
    sel.transition().duration(duration).ease(easeCubicInOut).call(z.transform, target);
  }, []);

  // Observable "zoom to bounding box" helper.
  const zoomToBounds = useCallback(
    (b: BBox, opts: ZoomFitOpts = {}) => {
      const { fill = 1, maxK = MAX_K, minK = 1, duration = DRILL_ZOOM_MS } = opts;
      if (!size.width || !size.height) return;
      const kk = computeFitScale(b, viewport, { fill, maxK, minK });
      const [[x0, y0], [x1, y1]] = inflateBoundsToMinSpan(b, viewport, fill, maxK);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;

      animateZoomTo(
        zoomIdentity.translate(viewport.centerX, viewport.centerY).scale(kk).translate(-cx, -cy),
        duration,
      );
    },
    [animateZoomTo, size.height, size.width, viewport],
  );

  const zoomToPoint = useCallback(
    (cx: number, cy: number, opts: ZoomFitOpts = {}) => {
      const { fill = ZOOM_FIT.facility.fill, maxK = ZOOM_FIT.facility.maxK, minK = 1, duration = DRILL_ZOOM_MS } = opts;
      const half = Math.min(viewport.width, viewport.height) * 0.055;
      zoomToBounds(
        [[cx - half, cy - half], [cx + half, cy + half]],
        { fill, maxK, minK, duration },
      );
    },
    [viewport.height, viewport.width, zoomToBounds],
  );

  const facilityProjectedPoints = useMemo(() => {
    if (!projection) return [] as { f: FacilityRanking; x: number; y: number }[];
    return facilities
      .filter((f) => f.lat != null && f.lon != null)
      .map((f) => {
        const [x, y] = projection([f.lon as number, f.lat as number]) as [number, number];
        return { f, x, y };
      });
  }, [facilities, projection]);

  const facilityFitBounds = useMemo(
    () => boundsFromProjectedPoints(facilityProjectedPoints),
    [facilityProjectedPoints],
  );

  /** Floor zoom for facility focus — never wider than the current district (or state) frame. */
  const scopeMinScale = useMemo(() => {
    if (!path || !viewport.width) return 1;
    if (selectedDistrict) {
      const polyB = selectedDistrictFeature ? path.bounds(selectedDistrictFeature) : null;
      const b = districtDrillBounds(polyB, facilityFitBounds);
      if (b) return computeFitScale(b, viewport, ZOOM_FIT.district);
    }
    if (selectedState) {
      const sf = findStateFeature(selectedState, statesFC.features);
      if (sf) return computeFitScale(path.bounds(sf), viewport, ZOOM_FIT.state);
    }
    return 1;
  }, [path, viewport, selectedDistrict, selectedDistrictFeature, facilityFitBounds, selectedState, statesFC.features]);

  // ── smooth zoom-to-bounds on drill (only when navigation changes, not data) ─
  const drillZoomKey = `${level}|${selectedState ?? ''}|${selectedDistrict ?? ''}|${selectedFacilityId ?? ''}|${selectedFacility?.lat ?? ''}|${selectedFacility?.lon ?? ''}|${districtLayersReady}|${viewport.extent.flat().join(',')}|${facilities.length}|${bboxSignature(facilityFitBounds)}`;
  const lastDrillZoomKey = useRef('');

  useEffect(() => {
    if (!path || !projection || !size.width || !zoomRef.current) return;
    if (drillZoomKey === lastDrillZoomKey.current) return;

    const run = () => {
      let applied = false;

      if (selectedFacilityId) {
        const f =
          (selectedFacility?.facilityId === selectedFacilityId ? selectedFacility : null) ??
          facilities.find((x) => x.facilityId === selectedFacilityId);
        if (f?.lat != null && f?.lon != null) {
          const [cx, cy] = projection([f.lon, f.lat]) as [number, number];
          zoomToPoint(cx, cy, { ...ZOOM_FIT.facility, minK: scopeMinScale });
          applied = true;
        } else if (!districtLayersReady && level === 'district') {
          return;
        }
      } else if (level === 'nation') {
        const b = path ? indiaBounds(path, nationFC, statesFC) : null;
        if (b) zoomToBounds(b, { ...ZOOM_FIT.nation, duration: lastDrillZoomKey.current ? DRILL_ZOOM_MS : 0 });
        else animateZoomTo(zoomIdentity, 0);
        applied = true;
      } else if (level === 'state' && selectedState) {
        const f = findStateFeature(selectedState, statesFC.features);
        if (f) {
          zoomToBounds(path.bounds(f), ZOOM_FIT.state);
          applied = true;
        } else {
          const c = stateCentroids.get(normName(selectedState));
          if (c) {
            zoomToPoint(c[0], c[1], ZOOM_FIT.state);
            applied = true;
          }
        }
      } else if (level === 'district' && selectedDistrict) {
        if (!districtLayersReady) {
          // Frame the parent state while district polygons load.
          if (selectedState) {
            const sf = findStateFeature(selectedState, statesFC.features);
            if (sf) {
              zoomToBounds(path.bounds(sf), { ...ZOOM_FIT.state, duration: DRILL_ZOOM_MS });
              applied = true;
            }
          }
          if (!applied) return;
        } else if (selectedFacilityId) {
          const f =
            (selectedFacility?.facilityId === selectedFacilityId ? selectedFacility : null) ??
            facilities.find((x) => x.facilityId === selectedFacilityId);
          if (f?.lat != null && f?.lon != null) {
            const [cx, cy] = projection([f.lon, f.lat]) as [number, number];
            zoomToPoint(cx, cy, { ...ZOOM_FIT.facility, minK: scopeMinScale });
            applied = true;
          } else if (selectedDistrictFeature) {
            zoomToBounds(path.bounds(selectedDistrictFeature), ZOOM_FIT.district);
            applied = true;
          }
        } else if (selectedDistrictFeature || facilityFitBounds) {
          const polyB = selectedDistrictFeature ? path.bounds(selectedDistrictFeature) : null;
          const fitB = districtDrillBounds(polyB, facilityFitBounds);
          if (fitB) {
            zoomToBounds(fitB, ZOOM_FIT.district);
            applied = true;
          }
        } else {
          const dr = districtRatings.find((d) => d.district === selectedDistrict && d.state === selectedState);
          if (dr && dr.lat != null && dr.lon != null) {
            const [cx, cy] = projection([dr.lon, dr.lat]) as [number, number];
            zoomToPoint(cx, cy, ZOOM_FIT.district);
            applied = true;
          }
        }
      }

      if (applied) lastDrillZoomKey.current = drillZoomKey;
    };

    const id = requestAnimationFrame(() => requestAnimationFrame(run));
    return () => cancelAnimationFrame(id);
  }, [
    drillZoomKey,
    level,
    selectedState,
    selectedDistrict,
    selectedFacilityId,
    selectedFacility,
    selectedDistrictFeature,
    districtLayersReady,
    facilities,
    path,
    projection,
    size.width,
    size.height,
    statesFC,
    nationFC,
    districtRatings,
    stateCentroids,
    facilityFitBounds,
    scopeMinScale,
    animateZoomTo,
    zoomToBounds,
    zoomToPoint,
  ]);

  // ── manual zoom controls (in / out / reset) ────────────────────────────────
  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const cur = zoomTransform(svg);
    const nk = Math.max(1, Math.min(MAX_K, cur.k * factor));
    const cx = viewport.centerX;
    const cy = viewport.centerY;
    const nx = cx - ((cx - cur.x) * nk) / cur.k;
    const ny = cy - ((cy - cur.y) * nk) / cur.k;
    animateZoomTo(zoomIdentity.translate(nx, ny).scale(nk), 250);
  };
  const resetZoom = () => {
    if (level === 'nation' && path) {
      const b = indiaBounds(path, nationFC, statesFC);
      if (b) {
        zoomToBounds(b, { ...ZOOM_FIT.nation, duration: 400 });
        return;
      }
    }
    animateZoomTo(zoomIdentity, 400);
  };

  const openFacilitySpider = useCallback((cx: number, cy: number, items: FacilityPoint[]) => {
    if (!items.length) return;
    const xs = items.map((p) => p.x);
    const ys = items.map((p) => p.y);
    const spreadX = Math.max(...xs) - Math.min(...xs);
    const spreadY = Math.max(...ys) - Math.min(...ys);
    if (spreadX > COLOCATED_EPS || spreadY > COLOCATED_EPS) {
      setSpider({ mode: 'geo', items });
      return;
    }
    setSpider({ mode: 'ring', cx, cy, items });
  }, []);

  /** One-click fit all hospitals in the current scope (no animated cluster steps). */
  const showAllHospitals = useCallback(() => {
    setExpandHospitals(true);
    setSpider(null);
    const fitB = boundsFromProjectedPoints(facilityProjectedPoints);
    if (fitB) {
      zoomToBounds(fitB, { ...ZOOM_FIT.facility, minK: scopeMinScale, duration: 0 });
    } else if (facilityProjectedPoints.length === 1) {
      const { x, y } = facilityProjectedPoints[0];
      zoomToPoint(x, y, { ...ZOOM_FIT.facility, minK: scopeMinScale, duration: 0 });
    }
  }, [facilityProjectedPoints, scopeMinScale, zoomToBounds, zoomToPoint]);

  const zoomIntoCluster = useCallback(
    (cx: number, cy: number, memberPoints: [number, number][], opts: ZoomFitOpts = {}) => {
      const fit = { ...ZOOM_FIT.cluster, ...opts };
      if (memberPoints.length >= 2) {
        const fitB = boundsFromProjectedPoints(memberPoints.map(([x, y]) => ({ x, y })));
        if (fitB) {
          const [[minX, minY], [maxX, maxY]] = fitB;
          // Co-located members — bounds fit won't move the scale; step zoom instead.
          if (maxX - minX < 3 && maxY - minY < 3) {
            const svg = svgRef.current;
            const curK = svg ? zoomTransform(svg).k : zoomK;
            const next = Math.min(fit.maxK ?? MAX_K, Math.max(curK * 1.55, curK + 1));
            animateZoomTo(
              zoomIdentity.translate(viewport.centerX, viewport.centerY).scale(next).translate(-cx, -cy),
              CLUSTER_ZOOM_MS,
            );
            return;
          }
          zoomToBounds(fitB, { ...fit, duration: CLUSTER_ZOOM_MS });
          return;
        }
      }
      const svg = svgRef.current;
      const curK = svg ? zoomTransform(svg).k : zoomK;
      const next = Math.min(fit.maxK ?? MAX_K, Math.max(curK * 1.45, curK + 0.75));
      animateZoomTo(
        zoomIdentity.translate(viewport.centerX, viewport.centerY).scale(next).translate(-cx, -cy),
        CLUSTER_ZOOM_MS,
      );
    },
    [animateZoomTo, zoomK, viewport.centerX, viewport.centerY, zoomToBounds],
  );

  const handleMapDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      e.preventDefault();
      if (spider) {
        setSpider(null);
        return;
      }
      const svg = svgRef.current;
      if (!svg) return;
      const cur = zoomTransform(svg);
      if (cur.k <= 1.02) {
        resetZoom();
        return;
      }
      zoomBy(1 / 1.65);
    },
    [spider, zoomBy, resetZoom],
  );

  // ── facility clustering (state & district levels) ───────────────────────────
  // Clusters in PROJECTED (data) space using a distance threshold of
  // CLUSTER_PX / k, so the grouping is translation-invariant (pan never re-runs
  // it) and breaks apart automatically as you zoom in. Recomputes only on the
  // coarse `zoomK` steps.
  const clusters = useMemo(() => {
    if (level === 'nation' || display === 'bubble' || !projection) return [];
    const spiderIds = spider
      ? new Set(spider.items.map((p) => p.f.facilityId))
      : null;
    const pts = facilityProjectedPoints.filter(
      (p) => !spiderIds?.has(p.f.facilityId) && p.f.facilityId !== selectedFacilityId,
    );
    // District / expand mode: show individual hospitals (merge only exact overlaps).
    const threshold = level === 'district' || expandHospitals ? 2 / zoomK : CLUSTER_PX / zoomK;
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
  }, [facilityProjectedPoints, projection, level, display, zoomK, spider, expandHospitals, selectedFacilityId]);

  const selectedFacilityPoint = useMemo(() => {
    if (!selectedFacilityId || !projection) return null;
    const f =
      (selectedFacility?.facilityId === selectedFacilityId ? selectedFacility : null) ??
      facilities.find((x) => x.facilityId === selectedFacilityId);
    if (!f || f.lat == null || f.lon == null) return null;
    const [x, y] = projection([f.lon, f.lat]) as [number, number];
    return { f, x, y };
  }, [selectedFacilityId, selectedFacility, facilities, projection]);

  // ── geography centroid clustering (states at nation, districts at state) ─────
  const geographyClusters = useMemo(() => {
    if (!projection || level === 'district' || display === 'bubble') return [] as {
      x: number;
      y: number;
      items: { state?: StateRating; district?: TopoDistrict }[];
    }[];

    const pts: { x: number; y: number; state?: StateRating; district?: TopoDistrict }[] =
      level === 'nation'
        ? stateRatings
            .map((s) => {
              const c = stateCentroids.get(normName(s.state));
              if (!c) return null;
              return { x: c[0], y: c[1], state: s };
            })
            .filter((p): p is { x: number; y: number; state: StateRating } => p != null)
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
  }, [projection, level, display, stateRatings, stateCentroids, topoDistrictsHere, zoomK]);

  // ── static (zoom-independent) layers ────────────────────────────────────────
  // Memoised so that a `zoomK` step (which only the bubbles/clusters/pins care
  // about) reuses this element tree and React skips reconciling the ~780
  // state/district paths — that's what keeps the fly-to animation smooth.
  const staticLayers = useMemo(() => {
    if (!path) return null;
    return (
      <>
        {/* ── India nation outline (SoI Level 1) ── */}
        {nationFC?.features.map((f) => (
          <path
            key="nation-outline"
            d={path(f) ?? undefined}
            fill="#f1f5f9"
            stroke={STATE_BORDER}
            strokeWidth={1.35}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            style={{ filter: level === 'nation' ? 'drop-shadow(0 2px 4px rgba(15,23,42,0.14))' : 'none' }}
          />
        ))}

        {/* ── state polygons (SoI Admin Level 2) ── */}
        {statesFC.features.map((f) => {
          const boundaryState = f.properties.st_nm;
          const dataState = resolveBoundaryState(boundaryState, stateRatings);
          const r = stateByNorm.get(normName(dataState)) ?? stateByNorm.get(normName(boundaryState));
          const metricVal = r ? valueOfState(r) : null;
          const hasMetric = metricVal !== null && Number.isFinite(metricVal);
          const isSel =
            selectedStateNorm === normName(dataState) || selectedStateNorm === normName(boundaryState);
          const dim = level !== 'nation' && !isSel;
          const fill =
            level !== 'nation'
              ? isSel
                ? '#ffffff'
                : '#eef2f6'
              : display === 'shade'
                ? hasMetric
                  ? colorOf(metricVal)
                  : NO_DATA_FILL
                : '#eef2f6';
          return (
            <path
              key={`st-${boundaryState}`}
              d={path(f) ?? undefined}
              fill={fill}
              fillOpacity={dim ? 0.55 : 1}
              stroke={STATE_BORDER}
              strokeWidth={isSel ? 1.5 : STATE_BORDER_WIDTH}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ cursor: level === 'nation' ? 'pointer' : 'default', transition: 'fill-opacity 200ms' }}
              onMouseEnter={() =>
                emitHover(
                  r
                    ? { kind: 'state', name: r.state, sub: `${r.facilities} facilities`, rating: r }
                    : { kind: 'state', name: dataState, sub: 'No surveyed facilities for this capability' },
                )
              }
              onMouseLeave={() => emitHover(null)}
              onClick={() => level === 'nation' && onSelectState(dataState)}
            />
          );
        })}

        {statesMesh && path && (
          <path
            d={path(statesMesh) ?? undefined}
            fill="none"
            stroke={STATE_MESH_STROKE}
            strokeWidth={STATE_MESH_WIDTH}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}

        {/* ── district polygons (SoI Admin Level 3) ── */}
        {level !== 'nation' && (
          <g key={`dl-${selectedStateNorm}`} className="dd-fade">
            {districtsHere.map((f) => {
              const td = dataForFeature(f);
              const boundaryName = titleCase(f.properties.district);
              const dataDistrict = resolveBoundaryDistrict(
                f.properties.district,
                selectedState ?? f.properties.st_nm,
                districtRatings,
              );
              const isSelDist = td
                ? td.primary.district === selectedDistrict
                : selectedDistrict != null &&
                  (normName(dataDistrict) === normName(selectedDistrict) ||
                    normName(boundaryName) === normName(selectedDistrict));
              const shaded = display === 'shade';
              const distMetric = td ? valueOfDistrict(td.primary) : null;
              const hasDistMetric = distMetric !== null && Number.isFinite(distMetric);
              return (
                <path
                  key={`dt-${f.properties.st_nm}-${f.properties.district}`}
                  d={path(f) ?? undefined}
                  fill={shaded ? (hasDistMetric ? colorOf(distMetric) : NO_DATA_FILL) : 'none'}
                  fillOpacity={shaded ? (td ? 0.92 : 0.55) : 0}
                  stroke={isSelDist ? '#0f172a' : STATE_BORDER}
                  strokeWidth={isSelDist ? 1.3 : 0.75}
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
                        : { kind: 'district', name: dataDistrict, sub: 'SoI district boundary · no surveyed facilities' },
                    )
                  }
                  onMouseLeave={() => emitHover(null)}
                  onClick={() => onSelectDistrict(td ? td.primary.district : dataDistrict)}
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
    nationFC,
    statesFC,
    statesMesh,
    stateRatings,
    districtRatings,
    districtsHere,
    stateByNorm,
    selectedState,
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

  const k = zoomK;
  if (!path || !projection) return <div ref={containerRef} className="h-full w-full" />;

  const districtPings =
    level === 'nation' ? [] : topoDistrictsHere.filter((d) => d.primary.lat != null && d.primary.lon != null);

  // Dominant trust signal of a cluster's members → cluster fill.
  const clusterSignal = (items: { f: FacilityRanking }[]) => {
    const tally: Record<string, number> = {};
    for (const { f } of items) {
      const s = effectiveTrustSignal(f);
      tally[s] = (tally[s] ?? 0) + 1;
    }
    return (Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'no_claim') as keyof typeof SIGNAL_COLORS;
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-xl border bg-[#eef4fb]">
      <style>{`@keyframes ddFadeIn{from{opacity:0}to{opacity:1}}.dd-fade{animation:ddFadeIn 450ms ease-out both}`}</style>
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        className="block touch-none"
        onDoubleClick={handleMapDoubleClick}
      >
        <g ref={gRef}>
          {staticLayers}

          {/* ── clustered geography pings (nation = states, state = districts) ── */}
          {!(level === 'state' && expandHospitals) &&
            geographyClusters.map((c, i) => {
            const n = c.items.length;
            const facilityTotal = clusterFacilityCount(c.items);
            const badgeR = clusterBadgeRadiusPx(facilityTotal, n);
            const baseR = screenPx(k, badgeR);
            const labelFont = clusterLabelFontPx(facilityTotal, badgeR);
            const countLabel = formatClusterLabel(facilityTotal);
            const first = c.items[0];
            const pingFill =
              n === 1 && first.state
                ? colorOf(valueOfState(first.state))
                : n === 1 && first.district
                  ? colorOf(valueOfDistrict(first.district.primary))
                  : '#0284c7';
            return (
              <g
                key={`geo-cl-${i}`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() =>
                  emitHover(
                    n > 1
                      ? {
                          kind: level === 'nation' ? 'state' : 'district',
                          name: `${countLabel} facilities`,
                          sub: `${n} regions · zoom in to split`,
                        }
                      : first.state
                        ? { kind: 'state', name: first.state.state, sub: `${first.state.facilities} facilities`, rating: first.state }
                        : first.district
                          ? {
                              kind: 'district',
                              name: first.district.primary.district,
                              sub: `${first.district.primary.state} · ${first.district.facilities} facilities`,
                              rating: first.district.primary,
                            }
                          : { kind: level === 'nation' ? 'state' : 'district', name: countLabel },
                  )
                }
                onMouseLeave={() => emitHover(null)}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => {
                  if (n > 1) {
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

                    zoomIntoCluster(c.x, c.y, memberPoints);
                    return;
                  }
                  if (first.state) onSelectState(first.state.state);
                  else if (first.district) onSelectDistrict(first.district.primary.district);
                }}
              >
                <circle cx={c.x} cy={c.y} r={baseR} fill={pingFill} fillOpacity={0.9} stroke="#ffffff" strokeWidth={1.3 / k} />
                <text
                  x={c.x}
                  y={c.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={screenPx(k, labelFont)}
                  fontWeight={700}
                  fill="#ffffff"
                  pointerEvents="none"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {countLabel}
                </text>
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

          {/* ── facility pins (district, or state after Hospitals toggle) ── */}
          {showFacilityPins && display === 'shade' && (
            <g key={`fl-${selectedState}-${selectedDistrict}`} className="dd-fade">
              {clusters.map((c, i) => {
                // Singleton → individual pin (with full hover/select behaviour).
                if (c.items.length === 1) {
                  const { f, x, y } = c.items[0];
                  const isHover = f.facilityId === hoveredFacilityId;
                  const isSel = f.facilityId === selectedFacilityId;
                  const showLabel = isSel || isHover;
                  return (
                    <FacilityPin
                      key={`fp-${f.facilityId}`}
                      f={f}
                      x={x}
                      y={y}
                      k={k}
                      isSel={isSel}
                      isHover={isHover}
                      showLabel={showLabel}
                      onSelect={onSelectFacility}
                      onHoverEnter={(fac) =>
                        emitHover({ kind: 'facility', name: fac.name, sub: `${fac.district}, ${fac.state}`, facility: fac })
                      }
                      onHoverLeave={() => emitHover(null)}
                    />
                  );
                }
                // Cluster bubble → count + dominant signal; click zooms in to split it.
                const n = c.items.length;
                const sig = clusterSignal(c.items);
                const badgeR = clusterBadgeRadiusPx(n, n);
                const rr = screenPx(k, badgeR);
                const labelFont = clusterLabelFontPx(n, badgeR);
                return (
                  <g
                    key={`cl-${i}`}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() =>
                      emitHover({
                        kind: 'facility',
                        name: `${n} facilities`,
                        sub:
                          level === 'district' || expandHospitals
                            ? 'Click to expand hospitals'
                            : 'Click to expand · double-click for instant list',
                        facility: c.items[0].f,
                      })
                    }
                    onMouseLeave={() => emitHover(null)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openFacilitySpider(c.x, c.y, c.items);
                    }}
                    onClick={() => {
                      if (n === 1) {
                        onSelectFacility(c.items[0].f);
                        return;
                      }
                      const memberPoints = c.items
                        .map(({ x, y }) => [x, y] as [number, number])
                        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
                      // District / expand: always fan out in place (no slow zoom steps).
                      if (level === 'district' || expandHospitals || n <= SPIDER_MAX_FACILITIES) {
                        openFacilitySpider(c.x, c.y, c.items);
                        return;
                      }
                      // State level large cluster: one instant zoom to split.
                      zoomIntoCluster(c.x, c.y, memberPoints, { duration: 0 });
                    }}
                  >
                    <circle cx={c.x} cy={c.y} r={Math.max(rr, 16 / k)} fill="transparent" />
                    <circle cx={c.x} cy={c.y} r={rr} fill={SIGNAL_COLORS[sig]} fillOpacity={0.9} stroke="#ffffff" strokeWidth={1.5 / k} />
                    <text
                      x={c.x}
                      y={c.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={screenPx(k, labelFont)}
                      fontWeight={700}
                      fill="#ffffff"
                      pointerEvents="none"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {n}
                    </text>
                  </g>
                );
              })}

              {/* spider fan-out — ring for co-located, true lat/lon when spread apart */}
              {spider && (
                <g key="spider" className="dd-fade" onDoubleClick={(e) => e.stopPropagation()}>
                  {(
                    spider.mode === 'geo'
                      ? spider.items.map((p) => ({ f: p.f, x: p.x, y: p.y, hub: undefined }))
                      : spider.items.map((p, i) => {
                          const n = spider.items.length;
                          const ring = n > 18 && i >= Math.ceil(n / 2) ? 1 : 0;
                          const ringCount = ring === 0 ? Math.ceil(n / (n > 18 ? 2 : 1)) : Math.floor(n / 2);
                          const ringIdx = ring === 0 ? i : i - Math.ceil(n / 2);
                          const R = ((ring === 0 ? 22 : 38) + ringCount * 2.6) / k;
                          const ang = (ringIdx / ringCount) * 2 * Math.PI - Math.PI / 2;
                          return {
                            f: p.f,
                            x: spider.cx + R * Math.cos(ang),
                            y: spider.cy + R * Math.sin(ang),
                            hub: [spider.cx, spider.cy] as [number, number],
                          };
                        })
                  ).map(({ f, x, y, hub }) => (
                    <g key={`sp-${f.facilityId}`}>
                      {hub && (
                        <line
                          x1={hub[0]}
                          y1={hub[1]}
                          x2={x}
                          y2={y}
                          stroke="#94a3b8"
                          strokeWidth={1 / k}
                          pointerEvents="none"
                        />
                      )}
                      <FacilityPin
                        f={f}
                        x={x}
                        y={y}
                        k={k}
                        isSel={f.facilityId === selectedFacilityId}
                        isHover={f.facilityId === hoveredFacilityId}
                        showLabel
                        onSelect={(fac) => {
                          setSpider(null);
                          onSelectFacility(fac);
                        }}
                        onHoverEnter={(fac) =>
                          emitHover({ kind: 'facility', name: fac.name, sub: `${fac.district}, ${fac.state}`, facility: fac })
                        }
                        onHoverLeave={() => emitHover(null)}
                      />
                    </g>
                  ))}
                  {spider.mode === 'ring' && (
                    <g
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSpider(null)}
                      onMouseEnter={() => emitHover({ kind: 'facility', name: 'Close', sub: 'Double-click map to zoom out' })}
                      onMouseLeave={() => emitHover(null)}
                    >
                      <circle cx={spider.cx} cy={spider.cy} r={9 / k} fill="#0f172a" fillOpacity={0.88} />
                      <text
                        x={spider.cx}
                        y={spider.cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={12 / k}
                        fontWeight={700}
                        fill="#ffffff"
                        pointerEvents="none"
                      >
                        ×
                      </text>
                    </g>
                  )}
                </g>
              )}

              {/* search-selected facility — always at true lat/lon, above clusters */}
              {selectedFacilityPoint && (
                <FacilityPin
                  key={`sel-${selectedFacilityPoint.f.facilityId}`}
                  f={selectedFacilityPoint.f}
                  x={selectedFacilityPoint.x}
                  y={selectedFacilityPoint.y}
                  k={k}
                  isSel
                  isHover={selectedFacilityPoint.f.facilityId === hoveredFacilityId}
                  showLabel
                  highlight
                  onSelect={onSelectFacility}
                  onHoverEnter={(fac) =>
                    emitHover({
                      kind: 'facility',
                      name: fac.name,
                      sub: `${fac.district}, ${fac.state}`,
                      facility: fac,
                    })
                  }
                  onHoverLeave={() => emitHover(null)}
                />
              )}
            </g>
          )}
        </g>
      </svg>

      {/* zoom controls + level indicator */}
      <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1">
        {level === 'state' && showPins && !expandHospitals && (
          <button
            type="button"
            onClick={showAllHospitals}
            title="Show individual hospital pins in this state"
            className="rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-sm hover:bg-slate-100"
          >
            Hospitals
          </button>
        )}
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
        <div className="rounded bg-white/90 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-700 shadow-sm">
          {level === 'district'
            ? `${k.toFixed(1)}× · hover pin for name`
            : level === 'state' && expandHospitals
              ? `${k.toFixed(1)}× · click # to expand`
              : `${k.toFixed(1)}× · click district to drill`}
        </div>
      </div>
    </div>
  );
}
