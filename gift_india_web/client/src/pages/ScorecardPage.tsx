import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import {
  api,
  SIGNAL_META,
  type FacilityDetail,
  type FacilitySearchResult,
  type CapabilityDetail,
  type TrustSignal,
} from '../lib/api';
import { SignalBadge, EvidenceTally, TrustScoreDial } from '../components/trust';
import { SIGNAL_ORDER, letterFromScore, capabilityGrade, GRADE_TONE } from '../lib/scorecard';

type GroupBy = 'capability' | 'signal';

/** Override-aware signal actually shown on the scorecard. */
function effSignal(c: CapabilityDetail): TrustSignal {
  return c.overrideSignal ?? c.trustSignal;
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

function CapabilityRow({ cap }: { cap: CapabilityDetail }) {
  const [open, setOpen] = useState(false);
  const sig = effSignal(cap);
  const score = Math.round(cap.trustScore * 100);
  const grade = capabilityGrade(sig, cap.trustScore);
  const claimed = sig !== 'no_claim';
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/40"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">{cap.label}</span>
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
          <EvidenceTally supporting={cap.supportingCount} contradicting={cap.contradictingCount} />
          {cap.bestSource && (
            <p className="text-xs text-muted-foreground">
              Best source: <span className="text-foreground">{cap.bestSource}</span>
            </p>
          )}
          {cap.evidence.length > 0 ? (
            <ul className="space-y-1.5">
              {cap.evidence.slice(0, 4).map((e) => (
                <li key={e.evidenceId} className="text-xs">
                  <span
                    className={`mr-1.5 font-semibold ${e.stance === 'supports' ? 'text-emerald-700' : 'text-red-700'}`}
                  >
                    {e.stance === 'supports' ? '✓' : '✗'}
                  </span>
                  <span className="text-foreground/80">{e.snippet}</span>{' '}
                  {e.sourceUrl ? (
                    <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {e.sourceLabel || 'source'}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{e.sourceLabel}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No citations recorded for this capability.</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SignalGroup({ signal, caps }: { signal: TrustSignal; caps: CapabilityDetail[] }) {
  const meta = SIGNAL_META[signal];
  const claimed = signal !== 'no_claim';
  const avg = claimed && caps.length ? caps.reduce((a, c) => a + c.trustScore, 0) / caps.length : null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
          <h3 className="text-base font-semibold text-foreground">{meta.label}</h3>
          <Badge variant="outline" className="text-[10px]">{caps.length}</Badge>
        </div>
        {avg !== null && <GradeBadge grade={letterFromScore(avg * 100)} />}
      </CardHeader>
      <CardContent className="p-0">
        {caps.map((c) => (
          <div
            key={c.key}
            className="flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-0"
          >
            <span className="min-w-0 flex-1 font-medium text-foreground">{c.label}</span>
            <span className="w-10 text-right text-sm font-bold tabular-nums text-foreground">
              {claimed ? Math.round(c.trustScore * 100) : '—'}
            </span>
            <GradeBadge grade={capabilityGrade(effSignal(c), c.trustScore)} />
          </div>
        ))}
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

  // Debounced facility search (empty query returns an initial list).
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
        // Auto-select the first facility the very first time, if none is chosen.
        setSelectedId((cur) => cur ?? res[0]?.facilityId ?? null);
      });
    }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const loadDetail = useMemo(
    () => async (id: string) => {
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
    },
    [],
  );

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
    for (const c of caps) {
      const s = effSignal(c);
      counts[s] += 1;
      if (s !== 'no_claim') {
        scoreSum += c.trustScore;
        claimed += 1;
      }
    }
    const avg = claimed ? scoreSum / claimed : null;
    return {
      counts,
      claimed,
      strong: counts.strong,
      avg,
      grade: avg === null ? '—' : letterFromScore(avg * 100),
      score: avg === null ? null : Math.round(avg * 100),
    };
  }, [caps]);

  const signalGroups = useMemo(
    () => SIGNAL_ORDER.map((s) => ({ signal: s, caps: caps.filter((c) => effSignal(c) === s) })).filter((g) => g.caps.length > 0),
    [caps],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* picker */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold leading-tight text-foreground">Facility scorecard</h2>
              <p className="text-sm text-muted-foreground">
                Evidence-backed capability grades for one facility, grouped by capability or by trust signal.
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
          {/* facility header + overall grade */}
          <Card>
            <CardContent className="space-y-3 p-4 md:p-5">
              <div className="flex items-start gap-4">
                <TrustScoreDial score={summary.avg ?? 0} signal={summary.strong > 0 ? 'strong' : 'partial'} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-lg font-bold text-foreground">{f.name}</h3>
                    <GradeBadge grade={summary.grade} className="h-10 w-10 text-xl" />
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
                      <a href={f.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Globe className="h-3.5 w-3.5" /> website
                      </a>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {summary.claimed > 0 ? (
                      <>
                        {summary.strong} of {summary.claimed} claimed capabilities backed by strong evidence
                        {summary.score !== null && <> · mean trust {summary.score}/100</>}
                      </>
                    ) : (
                      'No capabilities are claimed for this facility.'
                    )}
                  </p>
                </div>
              </div>
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

          {/* group-by toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Group by</span>
            <ToggleGroup type="single" value={groupBy} onValueChange={(v) => v && setGroupBy(v as GroupBy)} variant="outline" size="sm">
              <ToggleGroupItem value="capability" className="gap-1 text-xs">
                <Layers className="h-3.5 w-3.5" /> Capability
              </ToggleGroupItem>
              <ToggleGroupItem value="signal" className="gap-1 text-xs">
                <SignalHigh className="h-3.5 w-3.5" /> Signal type
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* grouped scorecard */}
          {groupBy === 'capability' ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
                <h3 className="text-base font-semibold text-foreground">Capabilities</h3>
                <span className="text-xs text-muted-foreground">score / 100 · grade</span>
              </CardHeader>
              <CardContent className="p-0">
                {caps.map((c) => (
                  <CapabilityRow key={c.key} cap={c} />
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
            Grades come from the evidence-backed trust score (A ≥ 75, B ≥ 60, C ≥ 45, D ≥ 25, else F). Capabilities with
            no claim are shown but ungraded. Signal-group grades average the trust scores in that bucket.
          </p>
        </>
      ) : (
        !loading && !error && <p className="px-1 text-sm text-muted-foreground">Search for a facility to see its scorecard.</p>
      )}
    </div>
  );
}
