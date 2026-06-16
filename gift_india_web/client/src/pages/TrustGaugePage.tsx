import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import {
  Card,
  CardContent,
  Skeleton,
  Alert,
  AlertTitle,
  AlertDescription,
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  ToggleGroup,
  ToggleGroupItem,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useIsMobile,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@databricks/appkit-ui/react';
import {
  ChevronDown,
  ChevronRight,
  MapPin,
  Building2,
  Search,
  ExternalLink,
  ShieldCheck,
  BadgeCheck,
  HeartPulse,
  Baby,
  Siren,
  Ribbon,
  Bone,
  Activity,
  Stethoscope,
  Info,
  PencilLine,
  type LucideIcon,
} from 'lucide-react';
import {
  api,
  type Capability,
  type RegionState,
  type FacilityRanking,
  type FacilityDetail,
  type TrustSignal,
  type Stats,
  formatNumber,
  humanReviewStatusForRanking,
} from '../lib/api';
import { SignalBadge, TrustScoreDial, EvidenceTally, CapabilityEvidence, BestSourceBadge, HumanReviewBadge } from '../components/trust';
import { GiftSeal } from '../components/GiftSeal';
import {
  INDIA_STATES,
  INDIA_UNION_TERRITORIES,
  ANALYZED_DISTRICTS,
  ANALYZED_DISTRICT_COUNT,
  ANALYZED_STATE_COUNT,
  navigatorLinkFor,
} from '../lib/coverage';

const SIGNAL_FILTERS: { value: TrustSignal | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'strong', label: 'Strong' },
  { value: 'partial', label: 'Partial' },
  { value: 'weak_suspicious', label: 'Suspicious' },
];

const CAP_ICON: Record<string, LucideIcon> = {
  icu: HeartPulse,
  maternity: Baby,
  emergency: Siren,
  oncology: Ribbon,
  trauma: Bone,
  nicu: Activity,
};

function CapabilityGuidePanel({ cap }: { cap: Capability }) {
  const Icon = CAP_ICON[cap.key] ?? ShieldCheck;
  const guide = cap.guide;
  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.04] to-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">What we verify — {cap.label}</h3>
            <p className="mt-1 text-sm leading-relaxed text-foreground/85">
              {guide?.headline ?? cap.description}
            </p>
          </div>
          {guide?.whatCounts?.length ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Evidence we look for
              </p>
              <ul className="mt-1.5 space-y-1 text-sm text-foreground/80">
                {guide.whatCounts.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary/60" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {guide?.howWeGrade ? (
            <div className="rounded-lg border bg-background/70 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                How grades work
              </p>
              <p className="mt-1 text-sm leading-relaxed text-foreground/80">{guide.howWeGrade}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Strong — corroborated
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Partial — plausible
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Suspicious — thin or conflicting
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                  No claim
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Hero quick-stat — big number with a trust-coloured accent. */
function HeroStat({ value, label, accent = 'text-foreground' }: { value: string; label: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className={`text-2xl font-bold tabular-nums leading-none sm:text-3xl ${accent}`}>{value}</span>
      <span className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</span>
    </div>
  );
}

/**
 * Coverage stat for the hero: shows how many states *and* districts we have
 * in-depth analysis for. Hovering (desktop) or tapping (mobile) reveals the
 * exact states/districts behind the number.
 */
function AnalyzedCoverageStat() {
  const isMobile = useIsMobile();

  const trigger = (
    <button
      type="button"
      className="flex flex-col rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <span className="text-2xl font-bold leading-none tabular-nums text-foreground sm:text-3xl">
        {ANALYZED_STATE_COUNT}
        {ANALYZED_DISTRICT_COUNT !== ANALYZED_STATE_COUNT && (
          <span className="text-base font-semibold text-muted-foreground sm:text-lg"> · {ANALYZED_DISTRICT_COUNT}</span>
        )}
      </span>
      <span className="mt-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground underline decoration-dotted underline-offset-2 sm:text-xs">
        {ANALYZED_DISTRICT_COUNT === ANALYZED_STATE_COUNT ? 'States & districts analysed' : 'States · districts analysed'}
        <Info className="h-3 w-3" />
      </span>
    </button>
  );

  const panel = (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {ANALYZED_STATE_COUNT} states analysed in depth
      </p>
      <ul className="mt-2.5 space-y-1">
        {ANALYZED_DISTRICTS.map((d) => (
          <li key={`${d.state}-${d.district}`}>
            <Link
              to={navigatorLinkFor(d)}
              className="-mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-sm font-semibold text-foreground">{d.state}</span>
                <span className="block text-xs text-muted-foreground">{d.district}</span>
              </span>
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
        Open one to drill the navigator map to it. More states &amp; districts coming soon.
      </p>
    </div>
  );

  if (isMobile) {
    return (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-4">
          {panel}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <HoverCard openDelay={100} closeDelay={100}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-4">
        {panel}
      </HoverCardContent>
    </HoverCard>
  );
}

function FacilityDetailBody({
  rec,
  cap,
  loading,
  reviewOpen,
  onReviewOpenChange,
  onSaved,
}: {
  rec: FacilityRanking;
  cap: FacilityDetail['capabilities'][number] | undefined;
  loading: boolean;
  reviewOpen: boolean;
  onReviewOpenChange: (open: boolean) => void;
  onSaved: (sig: TrustSignal | null, _note: string, score: number | null) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full rounded" />
        <Skeleton className="h-16 w-full rounded" />
        <Skeleton className="h-24 w-full rounded" />
      </div>
    );
  }
  if (!cap) {
    return <p className="text-sm text-muted-foreground">Could not load evidence for this facility.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">
          {cap.label} evidence
        </span>
        <Link
          to={`/facility/${encodeURIComponent(rec.facilityId)}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Full facility record <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <CapabilityEvidence
        cap={cap}
        facilityId={rec.facilityId}
        facilityName={rec.name}
        reviewOpen={reviewOpen}
        onReviewOpenChange={onReviewOpenChange}
        onSaved={onSaved}
      />
    </div>
  );
}

function FacilityRow({
  rec,
  capabilityKey,
}: {
  rec: FacilityRanking;
  capabilityKey: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<FacilityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [override, setOverride] = useState<TrustSignal | null>(rec.overrideSignal);
  const [overrideScore, setOverrideScore] = useState<number | null>(rec.overrideScore);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);

  const loadDetail = async () => {
    if (detail) return detail;
    setLoading(true);
    try {
      const d = await api.facility(rec.facilityId);
      setDetail(d);
      return d;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async () => {
    setOpen(true);
    if (!detail) await loadDetail();
  };

  const toggle = async () => {
    if (open) {
      setOpen(false);
      setReviewOpen(false);
      return;
    }
    await openDetail();
  };

  const cap = detail?.capabilities.find((c) => c.key === capabilityKey);
  const effectiveSignal = override ?? rec.trustSignal;
  const effectiveScore = overrideScore ?? rec.overrideScore ?? rec.trustScore;
  const humanReview = humanReviewStatusForRanking({
    ...rec,
    overrideSignal: override,
  });

  useEffect(() => {
    if (reviewPending && cap) {
      setReviewOpen(true);
      setReviewPending(false);
    }
  }, [reviewPending, cap]);

  const queueReview = (e: MouseEvent) => {
    e.stopPropagation();
    setOpen(true);
    if (cap) setReviewOpen(true);
    else {
      setReviewPending(true);
      void loadDetail();
    }
  };

  const overrideBtnClass = humanReview.recommended
    ? 'shrink-0 gap-1.5 border-amber-400 bg-amber-50 font-semibold text-amber-950 shadow-sm hover:border-amber-500 hover:bg-amber-100/80'
    : 'shrink-0 gap-1.5 border-border bg-background font-medium text-foreground shadow-sm hover:border-primary/45 hover:bg-muted/50';

  const detailBody = (
    <FacilityDetailBody
      rec={rec}
      cap={cap}
      loading={loading}
      reviewOpen={reviewOpen}
      onReviewOpenChange={setReviewOpen}
      onSaved={(sig, _note, score) => {
        setOverride(sig);
        setOverrideScore(score);
      }}
    />
  );

  return (
    <>
      <Card
        className={`overflow-hidden gift-lift ${
          humanReview.recommended ? 'border-amber-300/80 ring-1 ring-amber-200/60' : ''
        } ${open && !isMobile ? 'ring-1 ring-primary/25' : ''}`}
        data-demo={open && isMobile ? 'facility-expanded' : undefined}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => void toggle()}
            className={`flex min-w-0 flex-1 items-stretch gap-3 text-left transition-colors hover:bg-muted/40 ${
              humanReview.recommended ? 'border-l-4 border-l-amber-400' : ''
            }`}
          >
            <div className="flex items-center pl-3 text-muted-foreground">
              {open && isMobile ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </div>
            <div className="py-3">
              <TrustScoreDial score={effectiveScore} signal={effectiveSignal} />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5 py-3 pr-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">#{rec.rank}</span>
                <h3 className="truncate font-semibold text-foreground">{rec.name}</h3>
                <SignalBadge signal={effectiveSignal} />
                {humanReview.recommended ? <HumanReviewBadge /> : null}
              </div>
              {humanReview.recommended && humanReview.reason ? (
                <p className="text-xs font-medium text-amber-900/90">{humanReview.reason}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {rec.district}, {rec.state}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" /> {rec.type}
                </span>
                {rec.beds !== null && <span>{rec.beds} beds</span>}
              </div>
              <p className="text-sm text-foreground/80">{rec.summary}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <EvidenceTally supporting={rec.supportingCount} contradicting={rec.contradictingCount} />
                {rec.bestSource && <BestSourceBadge source={rec.bestSource} />}
              </div>
            </div>
          </button>
          <div className="flex items-center pr-3">
            <Button
              variant="outline"
              size="sm"
              className={overrideBtnClass}
              onClick={queueReview}
              aria-label={
                humanReview.recommended
                  ? `Start human review for ${rec.name}`
                  : `Override assessment for ${rec.name}`
              }
            >
              <PencilLine className="h-4 w-4" />
              <span className="hidden sm:inline">
                {humanReview.recommended ? 'Review' : 'Override'}
              </span>
            </Button>
          </div>
        </div>

        {isMobile && open && <CardContent className="border-t bg-muted/20 pt-4">{detailBody}</CardContent>}
      </Card>

      {!isMobile && (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setReviewOpen(false);
          }}
        >
          <DialogContent
            className="flex max-h-[min(88vh,820px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
            data-demo="facility-expanded"
          >
            <DialogHeader className="shrink-0 space-y-3 border-b bg-muted/20 px-6 py-5">
              <div className="flex flex-wrap items-start gap-4 pr-6">
                <TrustScoreDial score={effectiveScore} signal={effectiveSignal} size="lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <DialogTitle className="text-left text-xl leading-tight">
                    <span className="text-muted-foreground">#{rec.rank}</span> {rec.name}
                  </DialogTitle>
                  <DialogDescription asChild>
                    <div className="space-y-2 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <SignalBadge signal={effectiveSignal} size="lg" />
                        {humanReview.recommended ? <HumanReviewBadge /> : null}
                        <span className="inline-flex items-center gap-1 text-sm">
                          <MapPin className="h-3.5 w-3.5" /> {rec.district}, {rec.state}
                        </span>
                        <span className="inline-flex items-center gap-1 text-sm">
                          <Building2 className="h-3.5 w-3.5" /> {rec.type}
                        </span>
                      </div>
                      {humanReview.recommended && humanReview.reason ? (
                        <p className="text-sm font-medium text-amber-900/90">{humanReview.reason}</p>
                      ) : null}
                      <p className="text-sm text-foreground/80">{rec.summary}</p>
                    </div>
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{detailBody}</div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function TrustGaugePage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [regions, setRegions] = useState<RegionState[]>([]);

  const [capability, setCapability] = useState<string>('icu');
  const [stateName, setStateName] = useState<string>('all');
  const [district, setDistrict] = useState<string>('all');
  const [signal, setSignal] = useState<TrustSignal | 'all'>('all');
  const [query, setQuery] = useState('');

  const [results, setResults] = useState<FacilityRanking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch(() => undefined);
    // Exclude the synthetic "All" capability here — this is a per-capability
    // "verify" flow (the navigator is where the aggregate "All" view lives).
    api.capabilities().then((caps) => setCapabilities(caps.filter((c) => c.key !== 'all'))).catch(() => undefined);
    api.regions().then(setRegions).catch(() => undefined);
  }, []);

  const activeCap = capabilities.find((c) => c.key === capability);
  const districtsForState = useMemo(
    () => regions.find((r) => r.state === stateName)?.districts ?? [],
    [regions, stateName],
  );

  const search = useMemo(
    () => async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.facilities({
          capability,
          state: stateName === 'all' ? undefined : stateName,
          district: district === 'all' ? undefined : district,
          signal: signal === 'all' ? undefined : signal,
          q: query.trim() || undefined,
          limit: 60,
        });
        setResults(res.results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load facilities');
      } finally {
        setLoading(false);
      }
    },
    [capability, stateName, district, signal, query],
  );

  // Re-run whenever the capability / region / signal filters change (debounced for search text).
  useEffect(() => {
    const t = setTimeout(() => void search(), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [search, query]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* ── Hero / landing ───────────────────────────────────────────── */}
      <section
        data-demo="hero"
        className="gift-elevate overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-50 via-card to-amber-50"
      >
        <div className="flex items-start gap-6 p-5 sm:p-8">
          <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
            The GIFT Gauge · A Trust Gauge for Hospitals
          </div>
          <h1 className="mt-3 max-w-2xl text-2xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
            Governance, Integrity, &amp; Facility Trust (GIFT) Gauge
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Finally, a trust gauge that tells you which hospitals can actually deliver. Every capability claim is backed
            by citations you can read — and you can override the assessment with a reviewer note.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4">
            <HeroStat
              value={stats ? formatNumber(stats.facilities) : '—'}
              label="Facilities profiled"
              accent="text-emerald-700"
            />
            <span className="hidden h-10 w-px bg-border sm:block" />
            <AnalyzedCoverageStat />
            <span className="hidden h-10 w-px bg-border sm:block" />
            <HeroStat
              value={stats ? formatNumber(stats.citations) : '—'}
              label="Citations on record"
              accent="text-amber-700"
            />
            <span className="hidden h-10 w-px bg-border sm:block" />
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm">
              <BadgeCheck className="h-4 w-4 text-amber-600" />
              Gold-standard evidence rubric
            </div>
          </div>
          </div>
          <GiftSeal size={116} className="gift-seal-glow hidden shrink-0 self-center sm:block" />
        </div>
      </section>

      {/* ── Coverage so far ──────────────────────────────────────────────── */}
      <section data-demo="coverage" className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Detailed analysis so far</h2>
          <p className="text-xs text-muted-foreground">
            India has {INDIA_STATES} states and {INDIA_UNION_TERRITORIES} union territories. We currently have
            in-depth trust analysis for just {ANALYZED_DISTRICT_COUNT} districts — more coming soon.
          </p>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ANALYZED_DISTRICTS.map((d) => (
            <li key={`${d.state}-${d.district}`}>
              <Link
                to={navigatorLinkFor(d)}
                className="group flex h-full items-start gap-2 rounded-lg border bg-background/60 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:border-primary/40 focus-visible:outline-none"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {d.district} <span className="text-muted-foreground">({d.state})</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{d.blurb}</div>
                </div>
                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          ))}
          <li className="flex items-center justify-center rounded-lg border border-dashed px-3 py-2 text-xs font-medium text-muted-foreground">
            More districts coming soon
          </li>
        </ul>
      </section>

      {/* Capability selector */}
      <div data-demo="capabilities" className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Stethoscope className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Choose a capability to verify
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {capabilities.map((c) => {
            const Icon = CAP_ICON[c.key] ?? ShieldCheck;
            const active = capability === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCapability(c.key)}
                className={`group rounded-xl border p-3 text-left transition-all ${
                  active
                    ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30'
                    : 'border-border bg-card hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold text-foreground">{c.label}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {c.strong} strong
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-red-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    {c.weak} suspicious
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        {activeCap ? <CapabilityGuidePanel cap={activeCap} /> : null}
      </div>

      {/* Region + filters */}
      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">State</span>
            <Select
              value={stateName}
              onValueChange={(v) => {
                setStateName(v);
                setDistrict('all');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All states" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                {regions.map((r) => (
                  <SelectItem key={r.state} value={r.state}>
                    {r.state} ({r.facilities})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">District</span>
            <Select value={district} onValueChange={setDistrict} disabled={stateName === 'all'}>
              <SelectTrigger>
                <SelectValue placeholder="All districts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All districts</SelectItem>
                {districtsForState.map((d) => (
                  <SelectItem key={d.district} value={d.district}>
                    {d.district} ({d.facilities})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Trust signal</span>
            <ToggleGroup
              type="single"
              value={signal}
              onValueChange={(v) => v && setSignal(v as TrustSignal | 'all')}
              variant="outline"
              className="flex-wrap justify-start"
            >
              {SIGNAL_FILTERS.map((s) => (
                <ToggleGroupItem key={s.value} value={s.value} className="text-xs">
                  {s.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Search facility</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="name…"
                className="pl-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <Empty className="gift-fade-in rounded-xl border border-dashed">
          <EmptyHeader>
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Search className="h-6 w-6" />
            </span>
            <EmptyTitle>No facilities found</EmptyTitle>
            <EmptyDescription>
              No facility claims {activeCap?.label ?? 'this capability'} for the selected region and filter.
              Try a different region or signal.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div data-demo="results" className="gift-fade-in space-y-3">
          <p className="text-sm text-muted-foreground">
            {results.length} facilities with a <span className="font-medium text-foreground">{activeCap?.label}</span>{' '}
            claim
            {stateName !== 'all' && <> in {district !== 'all' ? `${district}, ` : ''}{stateName}</>}, ranked by evidence
            strength.
          </p>
          {results.map((rec) => (
            <FacilityRow key={rec.facilityId} rec={rec} capabilityKey={capability} />
          ))}
        </div>
      )}
    </div>
  );
}
