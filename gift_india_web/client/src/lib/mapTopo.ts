import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification';
import { normName } from './mapPalette';

/** Zonal region filters in the Geography popover (excludes "all"). */
export const REGION_TOPO_SLUG: Record<string, string> = {
  North: 'north',
  Central: 'central',
  East: 'east',
  West: 'west',
  South: 'south',
  'North-East': 'north-east',
};

/** Base map topology: lightweight nation+states, or zone-scoped states+districts. */
export function baseTopoUrl(regionFilter: string): string {
  if (regionFilter === 'all') return '/india-topo.json';
  const slug = REGION_TOPO_SLUG[regionFilter];
  return slug ? `/topo/india-${slug}.json` : '/india-topo.json';
}

/** Lazy district layer when drilling into a state from the all-India view. */
export function stateDistrictTopoUrl(state: string): string {
  return `/topo/districts/${normName(state)}.json`;
}

/** Zone topologies already ship districts; nation topo loads them on state drill. */
export function zoneTopoHasDistricts(regionFilter: string): boolean {
  return regionFilter !== 'all';
}

/** True when the topology includes a non-empty states layer (required to render). */
export function topologyHasStates(topology: Topology | null | undefined): boolean {
  const states = topology?.objects?.states as GeometryCollection | undefined;
  return Boolean(states?.geometries?.length);
}

/** Offset arc references when concatenating TopoJSON arc arrays. */
function reindexArcRef(i: number, offset: number): number {
  return i < 0 ? ~(~i + offset) : i + offset;
}

function reindexArcRefs(arcs: number | number[], offset: number): number | number[] {
  if (typeof arcs === 'number') return reindexArcRef(arcs, offset);
  return arcs.map((a) => reindexArcRefs(a, offset) as number);
}

function reindexGeometry(geom: GeometryObject, offset: number): GeometryObject {
  if (!('arcs' in geom) || geom.arcs == null) return geom;
  const arcs = reindexArcRefs(geom.arcs as number | number[], offset);
  return { ...geom, arcs } as GeometryObject;
}

/**
 * Merge a per-state district TopoJSON layer into the base topology.
 * District arcs are appended (with reindexed references) so state arcs stay valid.
 */
export function mergeDistrictTopo(base: Topology, districtTopo: Topology): Topology {
  const districtsObj = districtTopo.objects.districts as GeometryCollection | undefined;
  if (!districtsObj?.geometries?.length) return base;

  const arcOffset = base.arcs.length;
  const mergedArcs = districtTopo.arcs.length > 0 ? [...base.arcs, ...districtTopo.arcs] : base.arcs;
  const districts: GeometryCollection = {
    type: 'GeometryCollection',
    geometries: districtsObj.geometries.map((g) => reindexGeometry(g, arcOffset)),
  };

  return {
    ...base,
    arcs: mergedArcs,
    transform: base.transform ?? districtTopo.transform,
    objects: { ...base.objects, districts },
  };
}

/**
 * District layers from per-state TopoJSON files use their own transform and must
 * NOT be arc-merged into the nation topology (coordinates would be wrong).
 * Zone topologies already embed districts on the base topology.
 */
export function districtTopologySource(
  base: Topology,
  lazyDistrictLayer: Topology | null,
  regionFilter: string,
): Topology | null {
  if (zoneTopoHasDistricts(regionFilter)) {
    const districts = base.objects.districts as GeometryCollection | undefined;
    return districts?.geometries?.length ? base : null;
  }
  return lazyDistrictLayer;
}
