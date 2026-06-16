import type { CatalogMetric, TrustSignal } from '../lib/api';
import { SIGNAL_COLORS, facilityBubbleCap, facilityBubbleLegendSamples } from '../lib/mapPalette';
import { MapInfoPopover } from './MapInfoPopover';
import type { MapDisplay } from './DrilldownMap';

const NO_DATA_FILL = '#b8c6d6';

function formatLegendValue(v: number, unit: string): string {
  if (unit === 'score') return `${Math.round(v * 100)}%`;
  if (unit === 'percent') return `${v.toFixed(1)}%`;
  if (unit === 'count') return Math.round(v).toLocaleString();
  if (unit === 'inr') return `₹${Math.round(v).toLocaleString()}`;
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
}

const LEVEL_SCOPE: Record<string, string> = {
  nation: 'state',
  state: 'district',
  district: 'facility',
};

const ENDPOINT_LABELS: Record<string, { low: string; high: string }> = {
  score: { low: 'weak', high: 'strong' },
  percent: { low: 'low', high: 'high' },
  count: { low: 'low', high: 'high' },
};

export function MapLegend({
  level,
  activeMetric,
  effectiveLog,
  display,
  ramp,
  domain,
  capabilityLabel,
  facilityCounts,
}: {
  level: 'nation' | 'state' | 'district';
  activeMetric: CatalogMetric;
  effectiveLog: boolean;
  display: MapDisplay;
  ramp: string[];
  domain: [number, number] | null;
  capabilityLabel?: string;
  /** Facility counts in the current map scope — drives bubble-size legend samples. */
  facilityCounts?: number[];
}) {
  const scope = LEVEL_SCOPE[level];
  const title = level === 'district'
    ? 'Facility trust'
    : `${activeMetric.label}${effectiveLog ? ' · log' : ''} · ${scope}`;

  const bubbleCap = facilityCounts?.length ? facilityBubbleCap(facilityCounts) : null;
  const bubbleSamples = bubbleCap && display === 'bubble' ? facilityBubbleLegendSamples(bubbleCap) : [];

  if (level === 'district') {
    return (
      <div className="w-[6.5rem] rounded-lg border border-slate-200/80 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-1">
          <div className="text-[11px] font-semibold leading-tight text-slate-700">{title}</div>
          <MapInfoPopover level={level} activeMetric={activeMetric} display={display} capabilityLabel={capabilityLabel} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
          {(['strong', 'partial', 'weak_suspicious', 'no_claim'] as TrustSignal[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-[10px] font-medium text-slate-600">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SIGNAL_COLORS[s] }} />
              {s === 'weak_suspicious' ? 'Weak' : s === 'no_claim' ? 'No claim' : s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const endpoints = ENDPOINT_LABELS[activeMetric.unit] ?? { low: 'low', high: 'high' };
  const [lo, hi] = domain ?? [null, null];
  const startValue = lo !== null ? formatLegendValue(lo, activeMetric.unit) : '—';
  const stopValue = hi !== null ? formatLegendValue(hi, activeMetric.unit) : '—';

  return (
    <div className={`rounded-lg border border-slate-200/80 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur-sm ${display === 'bubble' ? 'w-[7.5rem]' : 'w-[6.5rem]'}`}>
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 text-[11px] font-semibold leading-tight text-slate-700">{title}</div>
        <MapInfoPopover level={level} activeMetric={activeMetric} display={display} capabilityLabel={capabilityLabel} />
      </div>

      <div className="mt-2 flex justify-between text-[10px] font-medium uppercase tracking-wide text-slate-400">
        <span>{endpoints.low}</span>
        <span>{endpoints.high}</span>
      </div>

      <div
        className="mt-1 h-2.5 w-full rounded-full"
        style={{ background: `linear-gradient(to right, ${ramp.join(', ')})` }}
      />

      <div className="mt-1 flex justify-between text-[12px] font-bold tabular-nums text-slate-700">
        <span>{startValue}</span>
        <span>{stopValue}</span>
      </div>

      {display === 'bubble' && bubbleSamples.length > 0 ? (
        <div className="mt-2 border-t border-dashed border-slate-200 pt-1.5">
          <div className="text-[10px] font-medium text-slate-500">Facility count</div>
          <div className="mt-1.5 flex items-end justify-between gap-0.5">
            {bubbleSamples.map(({ count, r }) => (
              <div key={count} className="flex flex-col items-center gap-0.5">
                <svg
                  width={r * 2 + 2}
                  height={r * 2 + 2}
                  aria-hidden
                  className="overflow-visible"
                >
                  <circle
                    cx={r + 1}
                    cy={r + 1}
                    r={r}
                    fill="#64748b"
                    fillOpacity={0.35}
                    stroke="#334155"
                    strokeWidth={0.6}
                  />
                </svg>
                <span className="text-[9px] font-semibold tabular-nums text-slate-600">
                  {count >= 1000 ? `${Math.round(count / 1000)}k` : count}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-2 border-t border-dashed border-slate-200 pt-1.5 text-[10px] text-slate-400">
          Colour by region
          {activeMetric.unit !== 'score' && activeMetric.unit !== 'count' && activeMetric.unit !== 'percent' && ` · ${activeMetric.unit}`}
        </div>
      )}

      {display === 'shade' && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-slate-600">
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-400/60" style={{ background: NO_DATA_FILL }} />
          No surveyed data
        </div>
      )}
    </div>
  );
}
