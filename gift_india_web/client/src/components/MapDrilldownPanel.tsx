import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Card,
  CardContent,
  Button,
  Skeleton,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@databricks/appkit-ui/react';
import {
  Building2,
  ChevronDown,
  ExternalLink,
  MapPin,
  PencilLine,
  X,
} from 'lucide-react';
import {
  api,
  effectiveTrustScore,
  effectiveTrustSignal,
  type DistrictRating,
  type FacilityDetail,
  type FacilityRanking,
  type RegionRating,
  type StateRating,
  type TrustSignal,
  formatNumber,
} from '../lib/api';
import type { HoverInfo } from './DrilldownMap';
import {
  BestSourceBadge,
  CapabilityEvidence,
  EvidenceTally,
  SignalBadge,
  TrustScoreDial,
} from './trust';
import { SIGNAL_COLORS } from '../lib/mapPalette';

type PanelLevel = 'nation' | 'state' | 'district';

type ReadoutGeoLevel = PanelLevel | 'facility';

const GEO_LEVEL_META: Record<
  ReadoutGeoLevel,
  { step: number; label: string; badgeClass: string }
> = {
  nation: { step: 1, label: 'National', badgeClass: 'bg-slate-100 text-slate-700 ring-slate-200' },
  state: { step: 2, label: 'State', badgeClass: 'bg-sky-50 text-sky-800 ring-sky-200' },
  district: { step: 3, label: 'District', badgeClass: 'bg-violet-50 text-violet-800 ring-violet-200' },
  facility: { step: 4, label: 'Facility', badgeClass: 'bg-primary/10 text-primary ring-primary/25' },
};

function GeoLevelBadge({ level }: { level: ReadoutGeoLevel }) {
  const m = GEO_LEVEL_META[level];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${m.badgeClass}`}
    >
      Level {m.step} · {m.label}
    </span>
  );
}

function BreakdownBar({ r }: { r: RegionRating }) {
  const noClaim = r.noClaim ?? 0;
  const total = Math.max(1, r.strong + r.partial + r.weak + noClaim);
  const seg = (n: number, color: string, label: string) =>
    n > 0 ? <div style={{ width: `${(n / total) * 100}%`, background: color }} title={`${label}: ${n}`} /> : null;
  return (
    <div className="space-y-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {seg(r.strong, SIGNAL_COLORS.strong, 'Strong')}
        {seg(r.partial, SIGNAL_COLORS.partial, 'Partial')}
        {seg(r.weak, SIGNAL_COLORS.weak_suspicious, 'Weak')}
        {seg(noClaim, SIGNAL_COLORS.no_claim, 'No claim')}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        <span>{r.strong} strong</span>
        <span>{r.partial} partial</span>
        <span>{r.weak} weak</span>
        {noClaim > 0 && <span>{noClaim} no claim</span>}
      </div>
    </div>
  );
}

function RegionDrilldownCard({
  geoLevel,
  title,
  sub,
  rating,
}: {
  geoLevel: PanelLevel;
  title: string;
  sub: string;
  rating: RegionRating;
}) {
  const sig = regionSignal(rating.avgScore);
  return (
    <Card className="gift-lift gift-fade-in border-border/80">
      <CardContent className="space-y-3 p-4">
        <GeoLevelBadge level={geoLevel} />
        <div className="flex items-start gap-3">
          <TrustScoreDial score={rating.avgScore ?? 0} signal={sig} />
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{sub}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {rating.avgScore === null
                ? 'No claims assessed'
                : `Region trust ${(rating.avgScore * 100).toFixed(0)} / 100`}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg border bg-card px-2 py-1.5">
            <div className="text-base font-bold tabular-nums">{formatNumber(rating.facilities)}</div>
            <div className="text-[10px] text-muted-foreground">facilities</div>
          </div>
          <div className="rounded-lg border bg-card px-2 py-1.5">
            <div className="text-base font-bold tabular-nums">{formatNumber(rating.claiming)}</div>
            <div className="text-[10px] text-muted-foreground">claim capability</div>
          </div>
        </div>
        <BreakdownBar r={rating} />
        <p className="text-[11px] text-muted-foreground">
          Select a facility on the map or in the list below to review sources and override the trust score.
        </p>
      </CardContent>
    </Card>
  );
}

function regionSignal(score: number | null): TrustSignal {
  if (score === null) return 'no_claim';
  if (score >= 0.7) return 'strong';
  if (score >= 0.45) return 'partial';
  return 'weak_suspicious';
}

function FacilityDrilldownCard({
  facility,
  capability,
  capabilityLabel,
  pinned,
  onClose,
  onUpdated,
}: {
  facility: FacilityRanking;
  capability: string;
  capabilityLabel?: string;
  pinned: boolean;
  onClose: () => void;
  onUpdated: (f: FacilityRanking) => void;
}) {
  const [detail, setDetail] = useState<FacilityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(true);

  const sig = effectiveTrustSignal(facility);
  const score = effectiveTrustScore(facility);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoading(true);
    setReviewOpen(false);
    api
      .facility(facility.facilityId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [facility.facilityId, capability]);

  const cap = detail?.capabilities.find((c) => c.key === capability);

  const applyOverride = (signal: TrustSignal | null, note: string, overrideScore: number | null) => {
    const updated: FacilityRanking = {
      ...facility,
      overrideSignal: signal,
      overrideScore,
      overrideNote: note || null,
      trustSignal: signal ?? facility.trustSignal,
      trustScore: overrideScore ?? facility.trustScore,
    };
    onUpdated(updated);
    if (detail && cap) {
      const capIdx = detail.capabilities.findIndex((c) => c.key === capability);
      if (capIdx >= 0) {
        const nextCaps = [...detail.capabilities];
        nextCaps[capIdx] = {
          ...cap,
          overrideSignal: signal,
          overrideScore,
          overrideNote: note || null,
        };
        setDetail({ ...detail, capabilities: nextCaps });
      }
    }
  };

  return (
    <Card className={`gift-fade-in ${pinned ? 'border-primary/40 gift-lift' : 'border-border/80'}`}>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <GeoLevelBadge level="facility" />
          {pinned ? (
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close facility panel"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Preview</span>
          )}
        </div>

        <div className="flex items-start gap-3">
          <TrustScoreDial score={score} signal={sig} />
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="font-semibold leading-snug text-foreground">{facility.name}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <SignalBadge signal={sig} />
              <span className="text-[11px] text-muted-foreground">rank #{facility.rank}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> {facility.district}, {facility.state}
          </span>
          <span className="inline-flex items-center gap-1">
            <Building2 className="h-3.5 w-3.5" /> {facility.type}
          </span>
          {facility.beds !== null && <span>{facility.beds} beds</span>}
        </div>

        <p className="text-sm text-foreground/80">{facility.summary}</p>

        <div className="flex flex-wrap items-center gap-2">
          <EvidenceTally supporting={facility.supportingCount} contradicting={facility.contradictingCount} />
          {facility.bestSource && <BestSourceBadge source={facility.bestSource} />}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setSourcesOpen(true);
              setReviewOpen(true);
            }}
            disabled={loading || !cap}
          >
            <PencilLine className="h-4 w-4" />
            Override score
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setSourcesOpen(true)}
            disabled={loading}
          >
            Show sources
          </Button>
          <Link
            to={`/facility/${encodeURIComponent(facility.facilityId)}`}
            className="inline-flex items-center gap-1 self-center px-2 text-xs text-primary hover:underline"
          >
            Full record <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        <Collapsible open={sourcesOpen} onOpenChange={setSourcesOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5 text-left text-sm font-semibold text-foreground hover:bg-muted/50"
            >
              <span>
                {capabilityLabel ?? capability} · evidence &amp; sources
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${sourcesOpen ? 'rotate-180' : ''}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full rounded" />
                <Skeleton className="h-24 w-full rounded" />
                <Skeleton className="h-20 w-full rounded" />
              </div>
            ) : !cap ? (
              <p className="text-sm text-muted-foreground">Could not load evidence for this facility.</p>
            ) : (
              <CapabilityEvidence
                cap={cap}
                facilityId={facility.facilityId}
                facilityName={facility.name}
                reviewOpen={reviewOpen}
                onReviewOpenChange={setReviewOpen}
                onSaved={applyOverride}
              />
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export interface MapDrilldownPanelProps {
  level: PanelLevel;
  hover: HoverInfo | null;
  selectedState: string | null;
  selectedDistrict: string | null;
  selectedFacility: FacilityRanking | null;
  selStateRating: StateRating | null;
  selDistrictRating: DistrictRating | null;
  national: RegionRating;
  capability: string;
  capabilityLabel?: string;
  onCloseFacility: () => void;
  onClearHover: () => void;
  onFacilityUpdated: (f: FacilityRanking) => void;
}

export function MapDrilldownPanel({
  level,
  hover,
  selectedState,
  selectedDistrict,
  selectedFacility,
  selStateRating,
  selDistrictRating,
  national,
  capability,
  capabilityLabel,
  onCloseFacility,
  onClearHover,
  onFacilityUpdated,
}: MapDrilldownPanelProps) {
  const focusFacility =
    selectedFacility ?? (hover?.kind === 'facility' && hover.facility ? hover.facility : null);

  if (focusFacility) {
    return (
      <FacilityDrilldownCard
        facility={focusFacility}
        capability={capability}
        capabilityLabel={capabilityLabel}
        pinned={selectedFacility?.facilityId === focusFacility.facilityId}
        onClose={() => {
          if (selectedFacility) onCloseFacility();
          else onClearHover();
        }}
        onUpdated={onFacilityUpdated}
      />
    );
  }

  if (hover?.kind === 'district' && hover.rating) {
    return (
      <RegionDrilldownCard
        geoLevel="district"
        title={hover.name}
        sub={(hover.rating as DistrictRating).state}
        rating={hover.rating}
      />
    );
  }

  if (hover?.kind === 'state' && hover.rating) {
    return (
      <RegionDrilldownCard geoLevel="state" title={hover.name} sub="India" rating={hover.rating} />
    );
  }

  if (level === 'district') {
    return (
      <RegionDrilldownCard
        geoLevel="district"
        title={selectedDistrict!}
        sub={selectedState ?? ''}
        rating={selDistrictRating ?? { facilities: 0, claiming: 0, avgScore: null, strong: 0, partial: 0, weak: 0, noClaim: 0 }}
      />
    );
  }

  if (level === 'state' && selStateRating) {
    return (
      <RegionDrilldownCard geoLevel="state" title={selectedState!} sub="India" rating={selStateRating} />
    );
  }

  return (
    <RegionDrilldownCard
      geoLevel="nation"
      title="India"
      sub={`All states · ${capabilityLabel ?? capability}`}
      rating={national}
    />
  );
}
