import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Skeleton,
  Badge,
} from '@databricks/appkit-ui/react';
import { api, formatNumber, type DistrictPoint, type Stats } from '../lib/api';

// Rough geographic bounds of mainland India for the lon/lat scatter.
const LON_MIN = 67;
const LON_MAX = 98;
const LAT_MIN = 6;
const LAT_MAX = 37;
const W = 620;
const H = 680;

function project(lon: number, lat: number): { x: number; y: number } {
  const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * W;
  const y = H - ((lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * H;
  return { x, y };
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {hint && <div className="text-xs text-muted-foreground/80 mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function MapPage() {
  const [districts, setDistricts] = useState<DistrictPoint[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<DistrictPoint | null>(null);

  useEffect(() => {
    Promise.all([api.districts(), api.stats()])
      .then(([d, s]) => {
        setDistricts(d);
        setStats(s);
      })
      .finally(() => setLoading(false));
  }, []);

  const topDeserts = useMemo(
    () =>
      [...districts]
        .filter((d) => d.surgical_facilities === 0)
        .sort((a, b) => b.population - a.population)
        .slice(0, 12),
    [districts],
  );

  const maxPop = useMemo(() => Math.max(1, ...districts.map((d) => d.population)), [districts]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-foreground">Medical desert map</h2>
        <p className="text-muted-foreground">
          Every district in the synced dataset, plotted by location. Red districts have <strong>no</strong> surgical facility on record.
        </p>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {loading || !stats ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
        ) : (
          <>
            <StatCard label="Districts tracked" value={formatNumber(Number(stats.districts))} />
            <StatCard
              label="Medical deserts"
              value={formatNumber(Number(stats.desert_districts))}
              hint="0 surgical facilities"
            />
            <StatCard label="Surgical facilities" value={formatNumber(Number(stats.surgical_facilities))} />
            <StatCard label="People covered" value={formatNumber(Number(stats.population_covered))} />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>District access map</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-3 pt-1">
              <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-destructive" /> No surgical facility</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-warning" /> 1–3 facilities</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-success" /> 4+ facilities</span>
              <span className="text-muted-foreground">· dot size = population</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="w-full" style={{ height: 480 }} />
            ) : (
              <div className="relative w-full">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Map of Indian districts by surgical access">
                  {districts.map((d) => {
                    const { x, y } = project(d.lon, d.lat);
                    if (x < 0 || x > W || y < 0 || y > H) return null;
                    const r = 2 + Math.sqrt(d.population / maxPop) * 9;
                    const color =
                      d.surgical_facilities === 0
                        ? 'var(--destructive)'
                        : d.surgical_facilities <= 3
                          ? 'var(--warning)'
                          : 'var(--success)';
                    return (
                      <circle
                        key={`${d.district}|${d.state}`}
                        cx={x}
                        cy={y}
                        r={r}
                        fill={color}
                        fillOpacity={0.55}
                        stroke={color}
                        strokeOpacity={0.9}
                        strokeWidth={0.5}
                        onMouseEnter={() => setHover(d)}
                        onMouseLeave={() => setHover(null)}
                        style={{ cursor: 'pointer' }}
                      />
                    );
                  })}
                </svg>
                {hover && (
                  <div className="absolute top-2 right-2 bg-popover border rounded-lg shadow-md p-3 text-sm max-w-[220px]">
                    <div className="font-semibold text-foreground">{hover.district}</div>
                    <div className="text-muted-foreground">{hover.state}</div>
                    <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      <div>{formatNumber(hover.population)} people</div>
                      <div>{hover.surgical_facilities} surgical facilities</div>
                      {hover.csection_pct !== null && <div>C-section rate: {hover.csection_pct.toFixed(1)}%</div>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Largest deserts</CardTitle>
            <CardDescription>Most populous districts with zero surgical facilities</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)
            ) : (
              topDeserts.map((d) => (
                <div key={`${d.district}|${d.state}`} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{d.district}</div>
                    <div className="text-xs text-muted-foreground truncate">{d.state}</div>
                  </div>
                  <Badge variant="destructive">{formatNumber(d.population)}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
