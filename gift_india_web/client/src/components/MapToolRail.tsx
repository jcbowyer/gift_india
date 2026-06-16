import type { ReactNode } from 'react';
import { Home, LayoutGrid } from 'lucide-react';
import { ScrollArea } from '@databricks/appkit-ui/react';
import type { MapDisplay } from './DrilldownMap';
import type { CatalogGroup, CatalogMetric } from '../lib/api';

export type MapFlyoutId = 'layer' | 'scale' | 'metric';

function ScaleHalfIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.25" />
      <path d="M12 3.5v17" stroke="currentColor" strokeWidth="2.25" />
      <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5H12V3.5z" fill="currentColor" />
    </svg>
  );
}

function PinsIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="6.25"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2.25"
      />
    </svg>
  );
}

function RailButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={[
        'map-tool-rail-btn flex items-center justify-center rounded-lg',
        'h-8 w-8 transition-[background-color,color,box-shadow] duration-150',
        active
          ? 'bg-[#24345b] text-white shadow-[0_2px_8px_rgba(20,30,45,0.16)]'
          : 'bg-white text-[#6b778c] shadow-[0_1px_3px_rgba(20,30,45,0.07)] hover:text-slate-700',
        disabled ? 'cursor-default opacity-45' : 'cursor-pointer',
      ].join(' ')}
    >
      <span className="flex h-4 w-4 items-center justify-center [&_svg]:h-[15px] [&_svg]:w-[15px]">{children}</span>
    </button>
  );
}

function FlyoutOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] font-medium transition-colors',
        selected
          ? 'border-[#1a2332] bg-[#1a2332] text-white'
          : 'border-border bg-card text-foreground hover:bg-muted/50',
      ].join(' ')}
    >
      <span
        className={[
          'h-2.5 w-2.5 shrink-0 rounded-full border-2',
          selected ? 'border-white bg-white' : 'border-slate-300 bg-transparent',
        ].join(' ')}
      />
      {label}
    </button>
  );
}

interface MapToolRailProps {
  flyout: MapFlyoutId | null;
  onFlyoutChange: (id: MapFlyoutId | null) => void;
  showPins: boolean;
  onShowPinsChange: (show: boolean) => void;
  canHome: boolean;
  onHome: () => void;
  display: MapDisplay;
  onDisplayChange: (d: MapDisplay) => void;
  logScale: boolean;
  logDisabled: boolean;
  onLogScaleChange: (log: boolean) => void;
  groups: CatalogGroup[];
  activeMetric: CatalogMetric;
  onMetricChange: (m: CatalogMetric) => void;
}

export function MapToolRail({
  flyout,
  onFlyoutChange,
  showPins,
  onShowPinsChange,
  canHome,
  onHome,
  display,
  onDisplayChange,
  logScale,
  logDisabled,
  onLogScaleChange,
  groups,
  activeMetric,
  onMetricChange,
}: MapToolRailProps) {
  const toggleFlyout = (id: MapFlyoutId) => onFlyoutChange(flyout === id ? null : id);
  const closeFlyout = () => onFlyoutChange(null);

  const flatMetrics = groups.flatMap((g) => g.metrics);

  return (
    <div className="rounded-lg bg-[#ebeef2]/95 p-0.5 shadow-sm backdrop-blur-sm">
      <div className="relative">
        <div className="flex flex-col gap-0.5">
          <RailButton
            label="Home"
            active={false}
            disabled={!canHome}
            onClick={() => {
              onHome();
              closeFlyout();
            }}
          >
            <Home strokeWidth={2.25} />
          </RailButton>

          <RailButton label="Layer" active={flyout === 'layer'} onClick={() => toggleFlyout('layer')}>
            <LayoutGrid strokeWidth={2.25} />
          </RailButton>

          <RailButton
            label="Scale"
            active={flyout === 'scale'}
            disabled={logDisabled}
            onClick={() => !logDisabled && toggleFlyout('scale')}
          >
            <ScaleHalfIcon />
          </RailButton>

          <RailButton label="Metric" active={flyout === 'metric'} onClick={() => toggleFlyout('metric')}>
            <span className="text-[13px] font-bold leading-none">№</span>
          </RailButton>

          <RailButton
            label="Pins"
            active={showPins}
            onClick={() => {
              onShowPinsChange(!showPins);
              closeFlyout();
            }}
          >
            <PinsIcon filled={showPins} />
          </RailButton>
        </div>

        {flyout && (
          <div
            className="absolute left-[calc(100%+0.375rem)] top-0 z-20 w-[200px] rounded-xl border bg-card p-2.5 shadow-[0_10px_30px_rgba(20,30,45,0.16)] gift-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {flyout === 'layer' ? 'Map layer' : flyout === 'scale' ? 'Color scale' : 'Metric'}
            </div>

            {flyout === 'layer' && (
              <div className="space-y-1.5">
                <FlyoutOption
                  label="Filled shading"
                  selected={display === 'shade'}
                  onSelect={() => {
                    onDisplayChange('shade');
                    closeFlyout();
                  }}
                />
                <FlyoutOption
                  label="Proportional bubbles"
                  selected={display === 'bubble'}
                  onSelect={() => {
                    onDisplayChange('bubble');
                    closeFlyout();
                  }}
                />
              </div>
            )}

            {flyout === 'scale' && !logDisabled && (
              <div className="space-y-1.5">
                <FlyoutOption
                  label="Linear"
                  selected={!logScale}
                  onSelect={() => {
                    onLogScaleChange(false);
                    closeFlyout();
                  }}
                />
                <FlyoutOption
                  label="Logarithmic"
                  selected={logScale}
                  onSelect={() => {
                    onLogScaleChange(true);
                    closeFlyout();
                  }}
                />
              </div>
            )}

            {flyout === 'metric' && (
              <ScrollArea className="max-h-[min(320px,50vh)] pr-2">
                <div className="space-y-2">
                  {flatMetrics.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Loading metrics…</p>
                  ) : (
                    groups.map((g) => (
                      <div key={g.category}>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g.category}</div>
                        <div className="space-y-1">
                          {g.metrics.map((m) => {
                            const selected = activeMetric.source === m.source && activeMetric.key === m.key;
                            return (
                              <FlyoutOption
                                key={`${m.source}-${m.key}`}
                                label={m.label}
                                selected={selected}
                                onSelect={() => {
                                  onMetricChange(m);
                                  closeFlyout();
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
