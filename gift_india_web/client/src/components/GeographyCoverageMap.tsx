import { useEffect, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { scaleLinear } from 'd3-scale';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Geometry } from 'geojson';
import type { DataQualityGeographyStateRow } from '../lib/api';
import { normName, placeMatch, resolveBoundaryState } from '../lib/mapPalette';

const NO_DATA_FILL = '#b8c6d6';
const PAD = 24;

function coverageFill(pct: number | null): string {
  if (pct === null) return NO_DATA_FILL;
  return scaleLinear<string>()
    .domain([0, 25, 50, 80, 100])
    .range(['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#059669'])
    .clamp(true)(pct);
}

type StateProps = { st_nm: string };

export function GeographyCoverageMap({ byState }: { byState: DataQualityGeographyStateRow[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<{ name: string; row: DataQualityGeographyStateRow | null } | null>(null);

  useEffect(() => {
    fetch('/india-topo.json')
      .then((r) => r.json())
      .then(setTopology)
      .catch(() => setTopology(null));
  }, []);

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

  const statesFC = useMemo(() => {
    if (!topology) return null;
    const obj = topology.objects.states as GeometryCollection | undefined;
    return obj ? (feature(topology, obj) as FeatureCollection<Geometry, StateProps>) : null;
  }, [topology]);

  const byNorm = useMemo(
    () => new Map(byState.map((r) => [normName(r.state), r])),
    [byState],
  );

  const projection = useMemo(() => {
    if (!statesFC || !size.width || !size.height) return null;
    const extent: [[number, number], [number, number]] = [
      [PAD, PAD],
      [size.width - PAD, size.height - PAD],
    ];
    return geoMercator().fitExtent(extent, statesFC);
  }, [statesFC, size.width, size.height]);

  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  const lookup = (boundaryName: string) => {
    const dataState = resolveBoundaryState(boundaryName, byState);
    return byNorm.get(normName(dataState)) ?? byState.find((r) => placeMatch(r.state, boundaryName)) ?? null;
  };

  return (
    <div className="gift-elevate rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">Map rate by geography</h2>
        <span className="text-xs text-muted-foreground">District coverage shaded by state</span>
      </div>
      <div ref={containerRef} className="relative h-[min(52vh,28rem)] w-full bg-slate-50/60">
        {!topology || !path || !statesFC ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Loading map…
          </div>
        ) : (
          <svg width={size.width} height={size.height} className="block">
            {statesFC.features.map((f) => {
              const name = f.properties.st_nm;
              const row = lookup(name);
              const pct = row ? row.pct : null;
              const fill = row?.stateMapped ? coverageFill(pct) : NO_DATA_FILL;
              return (
                <path
                  key={name}
                  d={path(f) ?? undefined}
                  fill={fill}
                  stroke="#fff"
                  strokeWidth={0.75}
                  className="transition-[fill] duration-150"
                  onMouseEnter={() => setHover({ name: row?.state ?? name, row })}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </svg>
        )}
        {hover && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-lg border bg-white/95 px-3 py-2 text-center shadow-sm">
            <div className="text-sm font-semibold text-foreground">{hover.name}</div>
            {hover.row ? (
              <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {hover.row.withGeography.toLocaleString()} / {hover.row.facilities.toLocaleString()} facilities · {hover.row.pct.toFixed(1)}%
              </div>
            ) : (
              <div className="mt-0.5 text-xs text-muted-foreground">No facility data</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
