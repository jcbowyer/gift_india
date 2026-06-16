import type { ReactNode } from 'react';
import { ChevronRight, ArrowLeft } from 'lucide-react';
import { Button } from '@databricks/appkit-ui/react';
import type { FacilityRanking } from '../lib/api';

interface MapGeoBreadcrumbProps {
  selectedState: string | null;
  selectedDistrict: string | null;
  selectedFacility: FacilityRanking | null;
  districtsLoading?: boolean;
  districtsLoadFailed?: boolean;
  onNation: () => void;
  onState: (state: string) => void;
  onDistrict: (district: string) => void;
  onBack: () => void;
  /** Facility search rendered between breadcrumbs and filter actions. */
  search?: ReactNode;
  /** Filter controls rendered on the right (e.g. Geography / Facility ratings). */
  actions?: ReactNode;
}

function Crumb({
  level,
  label,
  active,
  onClick,
}: {
  level: string;
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  const body = (
    <span className="flex min-w-0 flex-col items-start leading-tight">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{level}</span>
      <span className={`max-w-[11rem] truncate ${active ? 'font-semibold text-foreground' : 'font-medium'}`}>{label}</span>
    </span>
  );

  if (onClick && !active) {
    return (
      <button type="button" onClick={onClick} className="shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground hover:text-foreground">
        {body}
      </button>
    );
  }

  return <span className="shrink-0 px-1.5 py-0.5 text-foreground">{body}</span>;
}

export function MapGeoBreadcrumb({
  selectedState,
  selectedDistrict,
  selectedFacility,
  districtsLoading,
  districtsLoadFailed,
  onNation,
  onState,
  onDistrict,
  onBack,
  search,
  actions,
}: MapGeoBreadcrumbProps) {
  const atNation = !selectedState && !selectedFacility;
  const canBack = !atNation;

  return (
    <div
      className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-slate-200/80 bg-card px-2 py-1.5 text-sm shadow-sm"
      aria-label="Map navigation"
    >
      <div className="flex min-w-0 shrink items-center gap-1">
        {canBack && (
          <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Back</span>
          </Button>
        )}
        {canBack && <span className="h-4 w-px shrink-0 bg-slate-200" aria-hidden />}
        <Crumb level="Level 1 · National" label="India" active={atNation} onClick={atNation ? undefined : onNation} />
        {selectedState && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Crumb
              level="Level 2 · State"
              label={selectedState}
              active={!selectedDistrict && !selectedFacility}
              onClick={selectedDistrict || selectedFacility ? () => onState(selectedState) : undefined}
            />
          </>
        )}
        {selectedDistrict && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Crumb
              level="Level 3 · District"
              label={selectedDistrict}
              active={!selectedFacility}
              onClick={selectedFacility ? () => onDistrict(selectedDistrict) : undefined}
            />
          </>
        )}
        {selectedFacility && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Crumb level="Level 4 · Facility" label={selectedFacility.name} active />
          </>
        )}
        {districtsLoading && selectedState && !selectedDistrict && (
          <span className="shrink-0 text-[10px] text-muted-foreground">Loading district boundaries…</span>
        )}
        {districtsLoadFailed && selectedState && !selectedDistrict && (
          <span className="shrink-0 text-[10px] text-destructive">District boundaries unavailable</span>
        )}
      </div>
      {search ? (
        <div className="order-3 w-full min-w-0 sm:order-none sm:max-w-xs sm:flex-1 lg:max-w-sm">{search}</div>
      ) : null}
      {actions ? <div className="order-2 ml-auto flex shrink-0 flex-wrap items-center gap-2 sm:order-none">{actions}</div> : null}
    </div>
  );
}
