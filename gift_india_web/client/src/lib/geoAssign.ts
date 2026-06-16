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
  // lon/lat bounding box for a cheap reject before the exact ray-cast.
  w: number;
  s: number;
  e: number;
  n: number;
}

/** Composite key `stateNorm|districtNorm` — unique per topology district. */
export const districtKey = (stateNorm: string, districtNorm: string): string =>
  `${stateNorm}|${districtNorm}`;

/**
 * Spatial locator over the topology's district polygons. Construct once per
 * topology (memoise on the topology reference) and reuse across renders — the
 * bounding-box pre-filter keeps `locate()` cheap enough to call for thousands of
 * ratings/facilities per drill.
 */
export class DistrictLocator {
  private items: Indexed[];

  constructor(topology: Topology) {
    const dfc = feature(
      topology,
      topology.objects.districts as GeometryCollection,
    ) as FeatureCollection<Geometry, DistrictProps>;
    this.items = dfc.features.map((f) => {
      const [[w, s], [e, n]] = bounds(f.geometry);
      const stateNorm = normName(f.properties.st_nm);
      const districtNorm = normName(f.properties.district);
      return {
        feature: f,
        hit: { state: f.properties.st_nm, district: f.properties.district, stateNorm, districtNorm },
        w,
        s,
        e,
        n,
      };
    });
  }

  /** Resolve a lon/lat to the district polygon that contains it, or null. */
  locate(lon: number, lat: number): DistrictHit | null {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    for (const it of this.items) {
      if (lon < it.w || lon > it.e || lat < it.s || lat > it.n) continue;
      if (geoContains(it.feature, [lon, lat])) return it.hit;
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
