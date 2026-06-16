import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Card,
  CardContent,
  CardHeader,
  Badge,
  Button,
  Skeleton,
  Alert,
  AlertTitle,
  AlertDescription,
  Input,
  ToggleGroup,
  ToggleGroupItem,
  Separator,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@databricks/appkit-ui/react';
import {
  Search,
  MapPin,
  Building2,
  Globe,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Layers,
  SignalHigh,
  UserCheck,
} from 'lucide-react';
import {
  api,
  SIGNAL_META,
  effectiveTrustScore,
  humanReviewStatusForCapability,
  type FacilityDetail,
  type FacilitySearchResult,
  type CapabilityDetail,
  type TrustSignal,
} from '../lib/api';
import {
  SignalBadge,
  TrustScoreDial,
  HumanReviewBadge,
  HumanReviewCallout,
  CapabilityEvidence,
} from '../components/trust';
import { AskGenieScorecard } from '../components/AskGenieScorecard';
import { SIGNAL_ORDER, letterFromScore, capabilityGrade, GRADE_TONE } from '../lib/scorecard';

type GroupBy = 'capability' | 'signal';

/** Override-aware signal actually shown on the scorecard. */
function effSignal(c: CapabilityDetail): TrustSignal {
  return c.overrideSignal ?? c.trustSignal;
}

function effScore(c: CapabilityDetail): number {
  return effectiveTrustScore(c);
}

function GradeBadge({ grade, className = '' }: { grade: string; className?: string }) {
  return (
    <span
      className={`flex h-8 w-8 items-center justify-center rounded-lg border text-base font-bold ${GRADE_TONE[grade] ?? GRADE_TONE['—']} ${className}`}
    >
      {grade}
    </span>
  );
}

function SignalMixBar({ counts }: { counts: Record<TrustSignal, number> }) {
  const total = Math.max(1, SIGNAL_ORDER.reduce((a, s) => a + counts[s], 0));
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      {SIGNAL_ORDER.map((s) =>
        counts[s] > 0 ? (
          <div
            key={s}
            style={{ width: `${(counts[s] / total) * 100}%` }}
            className={SIGNAL_META[s].dot}
            title={`${SIGNAL_META[s].label}: ${counts[s]}`}
          />
        ) : null,
      )}
    </div>
  );
}

function FacilityReviewBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  const noun = count === 1 ? 'capability needs' : 'capabilities need';
  return (
    <div
      className="rounded-lg border border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 px-3.5 py-3 text-sm text-amber-950 shadow-sm"
      role="status"
      data-demo="human-review-flag"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <UserCheck className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold leading-snug">Manual human review recommended</p>
          <p className="text-amber-900/90 leading-relaxed">
            {count} {noun} manual human review before relying on this facility score — expand flagged rows
            below or start a review to confirm with local ground truth.
          </p>
        </div>
      </div>
    </div>
  );
}

function CapabilityRow({
  cap,
  facilityId,
  facilityName,
  onSaved,
}: {
  cap: CapabilityDetail;
  facilityId: string;
  facilityName: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const sig = effSignal(cap);
  const scoreVal = effScore(cap);
  const score = Math.round(scoreVal * 100);
  const grade = capabilityGrade(sig, scoreVal);
  const claimed = sig !== 'no_claim';
  const humanReview = humanReviewStatusForCapability(cap);
  const flagged = humanReview.recommended;

  const startReview = () => {
    setOpen(true);
    setReviewOpen(true);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={`flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/40 ${
            flagged ? 'border-l-4 border-l-amber-400 bg-amber-50/25' : ''
          }`}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{cap.label}</span>
              {flagged ? <HumanReviewBadge compact /> : null}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{cap.summary}</span>
          </span>
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            {cap.evidenceCount} cite{cap.evidenceCount === 1 ? '' : 's'}
          </span>
          <SignalBadge signal={sig} />
          <span className="w-10 text-right text-sm font-bold tabular-nums text-foreground">
            {claimed ? score : '—'}
          </span>
          <GradeBadge grade={grade} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 border-b bg-muted/20 px-4 py-3 last:border-0">
          {flagged ? (
            <HumanReviewCallout status={humanReview} onReview={startReview} />
          ) : null}
          <CapabilityEvidence
            cap={cap}
            facilityId={facilityId}
            facilityName={facilityName}
            reviewOpen={reviewOpen}
            onReviewOpenChange={setReviewOpen}
            onSaved={() => onSaved()}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SignalGroup({
  signal,
  caps,
}: {
  signal: TrustSignal;
  caps: CapabilityDetail[];
}) {
  const meta = SIGNAL_META[signal];
  const claimed = signal !== 'no_claim';
  const sorted = useMemo(() => {
    return [...caps].sort((a, b) => {
      const ar = humanReviewStatusForCapability(a).recommended ? 0 : 1;
      const br = humanReviewStatusForCapability(b).recommended ? 0 : 1;
      return ar - br;
    });
  }, [caps]);
  const flaggedCount = caps.filter((c) => humanReviewStatusForCapability(c).recommended).length;
  const avg = claimed && caps.length ? caps.reduce((a, c) => a + effScore(c), 0) / caps.length : null;

  return (
    <Card className={`gift-lift ${flaggedCount > 0 ? 'border-amber-300/70 ring-1 ring-amber-200/50' : ''}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
          <h3 className="text-base font-semibold text-foreground">{meta.label}</h3>
          <Badge variant="outline" className="text-[10px]">
            {caps.length}
          </Badge>
          {flaggedCount > 0 ? (
            <Badge className="border-amber-400/80 bg-amber-50 text-[10px] font-semibold text-amber-950 hover:bg-amber-50">
              {flaggedCount} need review
            </Badge>
          ) : null}
        </div>
        {avg !== null && <GradeBadge grade={letterFromScore(avg * 100)} />}
      </CardHeader>
      <CardContent className="p-0">
        {sorted.map((c) => {
          const flagged = humanReviewStatusForCapability(c).recommended;
          return (
            <div
              key={c.key}
              className={`flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-0 ${
                flagged ? 'border-l-4 border-l-amber-400 bg-amber-50/25' : ''
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{c.label}</span>
                  {flagged ? <HumanReviewBadge compact /> : null}
                </span>
              </span>
              <span className="w-10 text-right text-sm font-bold tabular-nums text-foreground">
                {claimed ? Math.round(effScore(c) * 100) : '—'}
              </span>
              <GradeBadge grade={capabilityGrade(effSignal(c), effScore(c))} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function ScorecardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FacilitySearchResult[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));
  const [detail, setDetail] = useState<FacilityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('capability');

  const runSearch = useMemo(
    () => async (q: string) => {
      try {
        const res = await api.facilitySearch(q.trim() || undefined);
        setResults(res);
        return res;
      } catch {
        setResults([]);
        return [];
      }
    },
    [],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      void runSearch(query).then((res) => {
        setSelectedId((cur) => cur ?? res[0]?.facilityId ?? null);
      });
    }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.facility(id));
    } catch {
      setError('Could not load this facility.');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const t = setTimeout(() => void loadDetail(selectedId), 0);
    return () => clearTimeout(t);
  }, [selectedId, loadDetail]);

  const pick = (r: FacilitySearchResult) => {
    setSelectedId(r.facilityId);
    setSearchParams({ id: r.facilityId });
    setQuery('');
    setPickerOpen(false);
  };

  const f = detail?.facility;
  const caps = useMemo(() => detail?.capabilities ?? [], [detail]);

  const summary = useMemo(() => {
    const counts = { strong: 0, partial: 0, weak_suspicious: 0, no_claim: 0 } as Record<TrustSignal, number>;
    let scoreSum = 0;
    let claimed = 0;
    let needsReview = 0;
    for (const c of caps) {
      const s = effSignal(c);
      counts[s] += 1;
      if (s !== 'no_claim') {
        scoreSum += effScore(c);
        claimed += 1;
      }
      if (humanReviewStatusForCapability(c).recommended) needsReview += 1;
    }
    const avg = claimed ? scoreSum / claimed : null;
    return {
      counts,
      claimed,
      strong: counts.strong,
      needsReview,
      avg,
      grade: avg === null ? '—' : letterFromScore(avg * 100),
      score: avg === null ? null : Math.round(avg * 100),
    };
  }, [caps]);

  const signalGroups = useMemo(
    () =>
      SIGNAL_ORDER.map((s) => ({ signal: s, caps: caps.filter((c) => effSignal(c) === s) })).filter(
        (g) => g.caps.length > 0,
      ),
    [caps],
  );

  const genieFacility = f
    ? { name: f.name, district: f.district, state: f.state, facilityId: f.facilityId }
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-demo="scorecard">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold leading-tight text-foreground">Facility scorecard</h2>
              <p className="text-sm text-muted-foreground">
                Evidence-backed capability grades with human-review flags when automated evidence is thin or
                contradictory.
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/navigator">
                <MapPin className="h-4 w-4" /> Map
              </Link>
            </Button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              placeholder="Search facilities by name or district…"
              className="pl-9"
              onFocus={() => setPickerOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setPickerOpen(true);
              }}
            />
            {pickerOpen && results.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-popover shadow-md">
                {results.map((r) => (
                  <button
                    key={r.facilityId}
                    type="button"
                    onClick={() => pick(r)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60 ${
                      r.facilityId === selectedId ? 'bg-primary/5' : ''
                    }`}
                  >
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{r.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.district}, {r.state} · {r.type}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Scorecard unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && !detail ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : f && detail ? (
        <>
          <Card
            className={`gift-elevate gift-fade-in ${
              summary.needsReview > 0 ? 'border-amber-300/80 ring-1 ring-amber-200/60' : ''
            }`}
          >
            <CardContent className="space-y-3 p-4 md:p-5">
              <div className="flex items-start gap-4">
                <TrustScoreDial score={summary.avg ?? 0} signal={summary.strong > 0 ? 'strong' : 'partial'} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-lg font-bold text-foreground">{f.name}</h3>
                    <div className="flex items-center gap-2">
                      {summary.needsReview > 0 ? <HumanReviewBadge /> : null}
                      <GradeBadge grade={summary.grade} className="h-10 w-10 text-xl" />
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" /> {f.district}, {f.state}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" /> {f.type}
                    </span>
                    {f.beds !== null && <span>{f.beds} beds</span>}
                    {f.websiteUrl && (
                      <a
                        href={f.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Globe className="h-3.5 w-3.5" /> website
                      </a>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {summary.claimed > 0 ? (
                      <>
                        {summary.strong} of {summary.claimed} claimed capabilities backed by strong evidence
                        {summary.score !== null && <> · mean trust {summary.score}/100</>}
                        {summary.needsReview > 0 && (
                          <> · {summary.needsReview} flagged for human review</>
                        )}
                      </>
                    ) : (
                      'No capabilities are claimed for this facility.'
                    )}
                  </p>
                </div>
              </div>
              <FacilityReviewBanner count={summary.needsReview} />
              <SignalMixBar counts={summary.counts} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                {SIGNAL_ORDER.map((s) =>
                  summary.counts[s] > 0 ? (
                    <span key={s} className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${SIGNAL_META[s].dot}`} />
                      {summary.counts[s]} {SIGNAL_META[s].short.toLowerCase()}
                    </span>
                  ) : null,
                )}
                <Link
                  to={`/facility/${encodeURIComponent(f.facilityId)}`}
                  className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Full record <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          <AskGenieScorecard facility={genieFacility} />

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Group by</span>
            <ToggleGroup
              type="single"
              value={groupBy}
              onValueChange={(v) => v && setGroupBy(v as GroupBy)}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="capability" className="gap-1 text-xs">
                <Layers className="h-3.5 w-3.5" /> Capability
              </ToggleGroupItem>
              <ToggleGroupItem value="signal" className="gap-1 text-xs">
                <SignalHigh className="h-3.5 w-3.5" /> Signal type
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {groupBy === 'capability' ? (
            <Card className={summary.needsReview > 0 ? 'border-amber-200/80' : ''}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">Capabilities</h3>
                  {summary.needsReview > 0 ? (
                    <Badge className="border-amber-400/80 bg-amber-50 text-[10px] font-semibold text-amber-950 hover:bg-amber-50">
                      {summary.needsReview} need review
                    </Badge>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">score / 100 · grade</span>
              </CardHeader>
              <CardContent className="p-0">
                {[...caps]
                  .sort((a, b) => {
                    const ar = humanReviewStatusForCapability(a).recommended ? 0 : 1;
                    const br = humanReviewStatusForCapability(b).recommended ? 0 : 1;
                    return ar - br;
                  })
                  .map((c) => (
                    <CapabilityRow
                      key={c.key}
                      cap={c}
                      facilityId={f.facilityId}
                      facilityName={f.name}
                      onSaved={() => void loadDetail(f.facilityId)}
                    />
                  ))}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {signalGroups.map((g) => (
                <SignalGroup key={g.signal} signal={g.signal} caps={g.caps} />
              ))}
            </div>
          )}

          <Separator />
          <p className="px-1 text-xs text-muted-foreground">
            Grades come from the evidence-backed trust score (A ≥ 75, B ≥ 60, C ≥ 45, D ≥ 25, else F). Amber flags
            mean a planner should confirm with local ground truth before relying on the score — use Start human review
            to log an override. Ask Genie queries governed data; it does not change scores.
          </p>
        </>
      ) : (
        !loading && !error && (
          <>
            <AskGenieScorecard facility={null} />
            <p className="px-1 text-sm text-muted-foreground">Search for a facility to see its scorecard.</p>
          </>
        )
      )}
    </div>
  );
}
