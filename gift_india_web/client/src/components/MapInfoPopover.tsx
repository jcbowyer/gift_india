import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger, ScrollArea } from '@databricks/appkit-ui/react';
import type { CatalogMetric } from '../lib/api';
import type { MapDisplay } from './DrilldownMap';
import { SIGNAL_COLORS } from '../lib/mapPalette';

const NO_DATA_FILL = '#b8c6d6';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="mt-1 space-y-1 text-[12px] leading-snug text-foreground">{children}</ul>
    </div>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-1.5">
      <span className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

export function MapInfoPopover({
  level,
  activeMetric,
  display,
  capabilityLabel,
}: {
  level: 'nation' | 'state' | 'district';
  activeMetric: CatalogMetric;
  display: MapDisplay;
  capabilityLabel?: string;
}) {
  const scope = level === 'nation' ? 'state' : level === 'state' ? 'district' : 'facility';
  const cap = capabilityLabel ?? 'this capability';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          aria-label="How to read this map"
        >
          <Info className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        className="w-[min(15.5rem,calc(100vw-2.5rem))] p-0"
      >
        <ScrollArea className="max-h-[min(42vh,15.5rem)]">
          <div className="space-y-2.5 p-3">
            <div>
              <p className="text-[13px] font-semibold leading-tight text-foreground">Map guide</p>
              <p className="text-[11px] text-muted-foreground">{level} view</p>
            </div>

            <Section title="Navigate">
              <Bullet>
                Click a <strong>state</strong>, then a <strong>district</strong>, to drill down.
              </Bullet>
              <Bullet>
                <strong>Back</strong> or the breadcrumb returns up one level.
              </Bullet>
            </Section>

            {level !== 'district' ? (
              <Section title={display === 'shade' ? 'Colours' : 'Bubbles'}>
                {display === 'shade' ? (
                  <>
                    <Bullet>
                      {scope}s shaded by <strong>{activeMetric.label.toLowerCase()}</strong> for <strong>{cap}</strong>.
                    </Bullet>
                    <Bullet>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-400/60"
                          style={{ background: NO_DATA_FILL }}
                          aria-hidden
                        />
                        <span>
                          <strong>Gray</strong> = no surveyed facilities for {cap}.
                        </span>
                      </span>
                    </Bullet>
                    <Bullet>Gradient runs weak → strong where data exists.</Bullet>
                  </>
                ) : (
                  <>
                    <Bullet>Circle size = facility count per {scope}.</Bullet>
                    <Bullet>
                      <strong>Layer → Shade</strong> colours by {activeMetric.label.toLowerCase()}.
                    </Bullet>
                  </>
                )}
              </Section>
            ) : (
              <Section title="Pins">
                <Bullet>Each pin is a facility; colour = trust for {cap}:</Bullet>
                {(['strong', 'partial', 'weak_suspicious', 'no_claim'] as const).map((s) => (
                  <li key={s} className="flex items-center gap-1.5 pl-2.5 text-[12px]">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: SIGNAL_COLORS[s] }}
                      aria-hidden
                    />
                    {s === 'weak_suspicious' ? 'Weak' : s === 'no_claim' ? 'No claim' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </li>
                ))}
              </Section>
            )}

            <Section title="Tools">
              <Bullet>
                <strong>Capability pills</strong> — switch service line (may gray out regions).
              </Bullet>
              <Bullet>
                Left rail — home, layer, scale, metric, pins.
              </Bullet>
            </Section>
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
