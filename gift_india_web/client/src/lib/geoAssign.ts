// ── Point-in-polygon geography reconciliation ────────────────────────────────
// The scraped `state`/`district` text on ratings & facilities is dirty (district
// and city names leak into `state`; district spellings rarely match the Survey
// of India boundaries), so name-matching only resolves ~30% of districts and the
// map dead-ends before the third drill level. Every rating and facility, however,
// carries a real lat/lon — and the SoI topology is already loaded in the browser.
// So we assign each point to the district polygon that geometrically CONTAINS it
// (`d3-geo` `geoContains`) and key everything off the topology's own names. That
// makes the geography authoritative and self-consistent: a rating mislabelled
// "Sangli" still lands in Maharashtra · Sangli, and every district with data is
// reachable.

import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { normName } from './mapPalette';

interface DistrictProps {
  district: string;
  st_nm: string;
}

/** Topology district a point resolved to, plus pre-normalised match keys. */
export interface DistrictHit {
  state: string;
  district: string;
  stateNorm: string;
  districtNorm: string;
}

interface Indexed {
  feature: Feature<Geometry, DistrictProps>;
  hit: DistrictHit;
  w: number;
  s: number;
  e: number;
  n: number;
}

const GRID_CELL = 1; // degrees — buckets ~742 districts for fast lookup

function gridKeys(w: number, s: number, e: number, n: number): string[] {
  const keys: string[] = [];
  const x0 = Math.floor(w / GRID_CELL);
  const x1 = Math.floor(e / GRID_CELL);
  const y0 = Math.floor(s / GRID_CELL);
  const y1 = Math.floor(n / GRID_CELL);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) keys.push(`${x},${y}`);
  }
  return keys;
}

/** Composite key `stateNorm|districtNorm` — unique per topology district. */
export const districtKey = (stateNorm: string, districtNorm: string): string =>
  `${stateNorm}|${districtNorm}`;

const locatorCache = new WeakMap<Topology, DistrictLocator>();

/**
 * Spatial locator over the topology's district polygons. Construct once per
 * topology (memoise on the topology reference) and reuse across renders.
 */
export class DistrictLocator {
  private grid = new Map<string, Indexed[]>();

  constructor(topology: Topology) {
    const cached = locatorCache.get(topology);
    if (cached) {
      this.grid = cached.grid;
      return;
    }

    const dfc = feature(
      topology,
      topology.objects.districts as GeometryCollection,
    ) as FeatureCollection<Geometry, DistrictProps>;

    for (const f of dfc.features) {
      const [[w, s], [e, n]] = bounds(f.geometry);
      const stateNorm = normName(f.properties.st_nm);
      const districtNorm = normName(f.properties.district);
      const it: Indexed = {
        feature: f,
        hit: { state: f.properties.st_nm, district: f.properties.district, stateNorm, districtNorm },
        w,
        s,
        e,
        n,
      };
      for (const key of gridKeys(w, s, e, n)) {
        (this.grid.get(key) ?? this.grid.set(key, []).get(key)!).push(it);
      }
    }
    locatorCache.set(topology, this);
  }

  /** Resolve a lon/lat to the district polygon that contains it, or null. */
  locate(lon: number, lat: number): DistrictHit | null {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const cx = Math.floor(lon / GRID_CELL);
    const cy = Math.floor(lat / GRID_CELL);
    const seen = new Set<Indexed>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.grid.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const it of bucket) {
          if (seen.has(it)) continue;
          seen.add(it);
          if (lon < it.w || lon > it.e || lat < it.s || lat > it.n) continue;
          if (geoContains(it.feature, [lon, lat])) return it.hit;
        }
      }
    }
    return null;
  }
}

/** lon/lat bounding box of a GeoJSON geometry: [[west,south],[east,north]]. */
function bounds(geom: Geometry): [[number, number], [number, number]] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const visit = (coords: unknown): void => {
    if (typeof (coords as number[])[0] === 'number') {
      const [lon, lat] = coords as [number, number];
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      return;
    }
    for (const c of coords as unknown[]) visit(c);
  };
  if ('coordinates' in geom) visit(geom.coordinates);
  return [
    [w, s],
    [e, n],
  ];
}
