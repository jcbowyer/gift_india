import type { CatalogMetric, TrustSignal } from '../lib/api';
import { SIGNAL_COLORS } from '../lib/mapPalette';

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
}: {
  level: 'nation' | 'state' | 'district';
  activeMetric: CatalogMetric;
  effectiveLog: boolean;
  display: 'shade' | 'bubble';
  ramp: string[];
  domain: [number, number] | null;
}) {
  const scope = LEVEL_SCOPE[level];
  const title = level === 'district'
    ? 'Facility trust'
    : `${activeMetric.label}${effectiveLog ? ' · log' : ''} · ${scope}`;

  if (level === 'district') {
    return (
      <div className="w-[11rem] rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur-sm">
        <div className="text-[11px] font-semibold leading-tight text-slate-700">{title}</div>
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
    <div className="w-[11rem] rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur-sm">
      <div className="text-[11px] font-semibold leading-tight text-slate-700">{title}</div>

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

      <div className="mt-2 border-t border-dashed border-slate-200 pt-1.5 text-[10px] text-slate-400">
        {display === 'bubble' ? 'Size = facility count' : 'Colour by region'}
        {activeMetric.unit !== 'score' && activeMetric.unit !== 'count' && activeMetric.unit !== 'percent' && ` · ${activeMetric.unit}`}
      </div>
    </div>
  );
}
