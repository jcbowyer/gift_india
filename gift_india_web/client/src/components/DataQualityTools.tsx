import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Input } from '@databricks/appkit-ui/react';
import {
  api,
  type DataQualityFlag,
  type DataQualityFlagSummary,
  type DataQualityImprovementsSummary,
  type DataQualityMissingFacility,
  type MergeCandidate,
} from '../lib/api';
import { DataQualityPanelLoading } from './DataQualityLoadingState';

const FLAG_LABEL: Record<string, string> = {
  missing_url: 'Missing URL',
  low_confidence: 'Low entity match',
  contradiction: 'Contradicting evidence',
  duplicate_pair: 'Duplicate candidate',
};

const SEV_CLASS: Record<string, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-slate-100 text-slate-700',
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function DataQualityFlagKpis({ summary }: { summary: DataQualityFlagSummary | null }) {
  if (!summary) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-demo="flag-kpis">
      <div className="gift-elevate rounded-xl border bg-card p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open flags</span>
        <p className="text-2xl font-bold tabular-nums">{summary.totalOpen.toLocaleString()}</p>
      </div>
      <div className="gift-elevate rounded-xl border bg-card p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Merge queue</span>
        <p className="text-2xl font-bold tabular-nums">{summary.pendingMergeReviews.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground">Splink recommendations pending review</p>
      </div>
      <div className="gift-elevate rounded-xl border bg-card p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Missing URLs</span>
        <p className="text-2xl font-bold tabular-nums">{(summary.byType.missing_url ?? 0).toLocaleString()}</p>
      </div>
      <div className="gift-elevate rounded-xl border bg-card p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Low confidence</span>
        <p className="text-2xl font-bold tabular-nums">{(summary.byType.low_confidence ?? 0).toLocaleString()}</p>
      </div>
    </div>
  );
}

export function MissingUrlRow({
  facility,
  onSaved,
}: {
  facility: DataQualityMissingFacility;
  onSaved: (facilityId: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveWebsiteUrl({ facilityId: facility.facilityId, newUrl: url.trim(), note: note.trim() || undefined });
      onSaved(facility.facilityId);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-b last:border-0 hover:bg-muted/40">
      <td className="px-3 py-2 font-medium">
        <Link to={`/facility/${encodeURIComponent(facility.facilityId)}`} className="hover:underline">
          {facility.name}
        </Link>
      </td>
      <td className="px-3 py-2 text-muted-foreground">{facility.type ?? '—'}</td>
      <td className="px-3 py-2 text-muted-foreground">{facility.district}</td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1 min-w-[220px]">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hospital.example.org"
            className="h-8 text-xs"
            data-demo="website-url-input"
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reviewer note (optional)"
            className="h-8 text-xs"
          />
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" variant="outline" disabled={!url.trim() || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save URL'}
        </Button>
      </td>
    </tr>
  );
}

export function DuplicateFinderPanel() {
  const [rows, setRows] = useState<MergeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [clusterNotice, setClusterNotice] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .dataQualityDuplicates()
      .then(setRows)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const review = async (candidateId: string, decision: 'merge' | 'reject' | 'defer') => {
    setBusy(candidateId);
    setClusterNotice(null);
    try {
      const result = await api.saveMergeReview({
        candidateId,
        decision,
        note: notes[candidateId]?.trim() || undefined,
      });
      if (decision === 'merge' || decision === 'reject') {
        if (result.clustersRebuilt) {
          setClusterNotice('MDM clusters rebuilt — gold.facility_master updated.');
          load();
        } else {
          setClusterNotice('Review saved, but cluster rebuild failed — run make apply-merge-clusters.');
        }
      }
      setRows((prev) =>
        prev.map((r) =>
          r.candidateId === candidateId
            ? { ...r, reviewDecision: decision, reviewNote: notes[candidateId] ?? null }
            : r,
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <DataQualityPanelLoading variant="duplicates" />;
  }
  if (error) {
    return <p className="text-sm text-destructive py-6">{error}</p>;
  }

  const pending = rows.filter((r) => !r.reviewDecision || r.reviewDecision === 'defer');

  return (
    <div className="space-y-3" data-demo="duplicate-finder">
      <p className="text-sm text-muted-foreground">
        Probabilistic linkage across bronze sources via{' '}
        <code className="font-mono text-xs bg-muted px-1 rounded">Splink</code> — match scores and human review before
        rows combine in <code className="font-mono text-xs bg-muted px-1 rounded">gold.facility_master</code>.
      </p>
      {clusterNotice ? (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{clusterNotice}</p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No match candidates yet. Run <code className="font-mono text-xs">make splink-duplicates</code> against your
          warehouse.
        </p>
      ) : (
        <div className="gift-elevate rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex justify-between items-baseline">
            <h2 className="text-sm font-semibold">Match recommendations</h2>
            <span className="text-xs text-muted-foreground">{pending.length} pending human review</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 text-left">Left record</th>
                  <th className="px-4 py-2 text-left">Right record</th>
                  <th className="px-4 py-2 text-right">Match</th>
                  <th className="px-4 py-2 text-left">Recommendation</th>
                  <th className="px-4 py-2 text-left">Review</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const decided = r.reviewDecision === 'merge' || r.reviewDecision === 'reject';
                  return (
                    <tr
                      key={r.candidateId}
                      className={`border-b last:border-0 ${decided ? 'opacity-60' : 'hover:bg-muted/30'}`}
                    >
                      <td className="px-4 py-2">
                        <div className="font-medium">{r.leftName}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.leftSource} · {r.leftId}
                          {r.leftMasterId ? <> · master {r.leftMasterId}</> : null}
                          {r.leftSource === 'virtue' ? (
                            <>
                              {' '}
                              ·{' '}
                              <Link to={`/facility/${encodeURIComponent(r.leftId)}`} className="underline">
                                open
                              </Link>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{r.rightName}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.rightSource} · {r.rightId}
                          {r.rightMasterId ? <> · master {r.rightMasterId}</> : null}
                          {r.rightSource === 'virtue' ? (
                            <>
                              {' '}
                              ·{' '}
                              <Link to={`/facility/${encodeURIComponent(r.rightId)}`} className="underline">
                                open
                              </Link>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{pct(r.matchProbability)}</td>
                      <td className="px-4 py-2">
                        <span className="text-xs font-medium uppercase tracking-wide">{r.recommendation}</span>
                        <div className="text-xs text-muted-foreground mt-0.5">{r.flagReason}</div>
                      </td>
                      <td className="px-4 py-2 min-w-[240px]">
                        {decided ? (
                          <span className="text-xs font-medium capitalize">{r.reviewDecision}d</span>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <Input
                              value={notes[r.candidateId] ?? ''}
                              onChange={(e) => setNotes((n) => ({ ...n, [r.candidateId]: e.target.value }))}
                              placeholder="Reviewer note"
                              className="h-8 text-xs"
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={busy === r.candidateId}
                                onClick={() => review(r.candidateId, 'merge')}
                                data-demo="merge-approve"
                              >
                                Approve match
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy === r.candidateId}
                                onClick={() => review(r.candidateId, 'reject')}
                              >
                                Reject
                              </Button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function AutomatedFlagsPanel() {
  const [flags, setFlags] = useState<DataQualityFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    api
      .dataQualityFlags(filter === 'all' ? undefined : { type: filter })
      .then(setFlags)
      .finally(() => setLoading(false));
  }, [filter]);

  const types = ['all', 'missing_url', 'low_confidence', 'contradiction', 'duplicate_pair'];

  return (
    <div className="space-y-3" data-demo="automated-flags">
      <p className="text-sm text-muted-foreground">
        Automated flags from the pipeline — stored in{' '}
        <code className="font-mono text-xs bg-muted px-1 rounded">app.data_quality_flags</code>. Planners resolve via
        URL updates, merge reviews, or capability overrides on Trust Gauge.
      </p>
      <div className="flex flex-wrap gap-2">
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filter === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'
            }`}
          >
            {t === 'all' ? 'All' : FLAG_LABEL[t] ?? t}
          </button>
        ))}
      </div>
      {loading ? (
        <DataQualityPanelLoading variant="flags" />
      ) : flags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open flags for this filter.</p>
      ) : (
        <div className="gift-elevate rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 text-left">Facility</th>
                <th className="px-4 py-2 text-left">Flag</th>
                <th className="px-4 py-2 text-left">Detail</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <Link to={`/facility/${encodeURIComponent(f.facilityId)}`} className="font-medium hover:underline">
                      {f.facilityName || f.facilityId}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {f.district}, {f.state}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${SEV_CLASS[f.severity] ?? SEV_CLASS.medium}`}>
                      {FLAG_LABEL[f.flagType] ?? f.flagType}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{f.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function useDataQualityFlagSummary(enabled = true) {
  const [summary, setSummary] = useState<DataQualityFlagSummary | null>(null);
  useEffect(() => {
    if (!enabled) return;
    api.dataQualityFlagSummary().then(setSummary).catch(() => setSummary(null));
  }, [enabled]);
  return summary;
}

function matchRateColor(pct: number): string {
  if (pct >= 50) return 'bg-emerald-500';
  if (pct >= 25) return 'bg-blue-500';
  if (pct > 0) return 'bg-amber-500';
  return 'bg-muted-foreground/30';
}

function CrossSourceMatchSection({
  links,
  recentMatches,
  onReview,
}: {
  links: DataQualityImprovementsSummary['links'];
  recentMatches: DataQualityImprovementsSummary['recentMerges'];
  onReview: () => void;
}) {
  return (
    <section className="gift-elevate rounded-xl border bg-card overflow-hidden" data-demo="cross-source-matches">
      <div className="px-4 py-3 border-b flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Cross-source match rates</h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            Splink links bronze registry rows into shared golden records — a &ldquo;match&rdquo; means this row is
            tied to at least one other source (e.g. Virtue ↔ NABH), not a duplicate Virtue facility.
          </p>
        </div>
        <button
          type="button"
          onClick={onReview}
          className="text-xs font-medium text-primary hover:underline shrink-0"
        >
          Review match queue ({links.pendingPairs}) →
        </button>
      </div>

      <div className="px-4 py-3 border-b bg-muted/20 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground tabular-nums">{links.approvedPairs.toLocaleString()}</strong> pairs
          approved
        </span>
        <span>
          <strong className="text-foreground tabular-nums">{links.rejectedPairs.toLocaleString()}</strong> rejected
        </span>
        <span>
          <strong className="text-foreground tabular-nums">{links.pendingPairs.toLocaleString()}</strong> pending
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 text-left">Registry</th>
              <th className="px-4 py-2.5 text-right">Rows</th>
              <th className="px-4 py-2.5 text-right">Matched</th>
              <th className="px-4 py-2.5 text-left min-w-[200px]">Match rate</th>
            </tr>
          </thead>
          <tbody>
            {links.bySource.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-sm text-muted-foreground">
                  No cluster data yet — run <code className="font-mono text-xs">make splink-duplicates</code> then{' '}
                  <code className="font-mono text-xs">make apply-merge-clusters</code>.
                </td>
              </tr>
            ) : (
              links.bySource.map((row) => (
                <tr key={row.source} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-medium">{row.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.totalRows.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.matchedRows.toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden max-w-[140px]">
                        <div
                          className={`h-full rounded-full ${matchRateColor(row.matchPct)}`}
                          style={{ width: `${Math.min(100, row.matchPct)}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono font-semibold tabular-nums w-12">{row.matchPct}%</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(links.topPairs.length > 0 || recentMatches.length > 0) && (
        <div className="grid md:grid-cols-2 gap-0 md:divide-x border-t">
          <div className="p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Approved match types
            </h3>
            {links.topPairs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No approved pairs yet.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {links.topPairs.map((p) => (
                  <li key={p.pair} className="flex justify-between gap-2">
                    <span className="font-medium">
                      {p.pair
                        .split(' ↔ ')
                        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                        .join(' ↔ ')}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{p.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Recent approved matches
            </h3>
            {recentMatches.length === 0 ? (
              <p className="text-xs text-muted-foreground">No approved matches yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {recentMatches.map((m) => (
                  <li key={m.id} className="border-b last:border-0 pb-2">
                    <div className="font-medium truncate">{m.leftName} ↔ {m.rightName}</div>
                    <div className="text-muted-foreground">
                      {Math.round(m.matchProbability * 100)}% match · {m.reviewedBy}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ImprovementCard({
  title,
  value,
  sub,
  accent,
  onAction,
  actionLabel,
}: {
  title: string;
  value: string | number;
  sub: string;
  accent: string;
  onAction?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className={`gift-elevate rounded-xl border bg-card p-5 flex flex-col gap-2 border-l-4 ${accent}`}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</span>
      <span className="text-3xl font-bold tabular-nums text-foreground">{value}</span>
      <p className="text-sm text-muted-foreground flex-1">{sub}</p>
      {onAction && actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          className="text-xs font-medium text-primary hover:underline text-left w-fit"
        >
          {actionLabel} →
        </button>
      ) : null}
    </div>
  );
}

function TypeBreakdown({
  resolved,
  open,
  labels,
}: {
  resolved: Record<string, number>;
  open: Record<string, number>;
  labels: Record<string, string>;
}) {
  const types = [...new Set([...Object.keys(resolved), ...Object.keys(open)])].sort();
  if (types.length === 0) {
    return <p className="text-sm text-muted-foreground">No flag activity yet.</p>;
  }
  return (
    <div className="space-y-2">
      {types.map((t) => {
        const r = resolved[t] ?? 0;
        const o = open[t] ?? 0;
        const total = r + o;
        const pct = total > 0 ? Math.round((r / total) * 100) : 0;
        return (
          <div key={t} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium">{labels[t] ?? t}</span>
              <span className="text-muted-foreground tabular-nums">
                {r.toLocaleString()} fixed · {o.toLocaleString()} open
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DataQualitySummaryPanel({
  onGoToTab,
}: {
  onGoToTab: (tab: 'geography' | 'urls' | 'duplicates' | 'flags') => void;
}) {
  const [data, setData] = useState<DataQualityImprovementsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dataQualityImprovementsSummary()
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <DataQualityPanelLoading variant="summary" />;
  }
  if (error || !data) {
    return <p className="text-sm text-destructive py-6">{error ?? 'Failed to load summary'}</p>;
  }

  const { flags, links, websiteUrls, geography } = data;
  const virtueLink = links.bySource.find((s) => s.source === 'virtue');

  return (
    <div className="space-y-6" data-demo="dq-summary">
      <p className="text-sm text-muted-foreground">
        Human-in-the-loop and automated fixes tracked in{' '}
        <code className="font-mono text-xs bg-muted px-1 rounded">app.*</code> audit tables — geography linkage,
        cross-source matches, quality flags resolved, and website addresses corrected on the Virtue spine.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ImprovementCard
          title="Geography linked"
          value={`${geography.facilityLinkPct}%`}
          sub={`${geography.facilitiesLinked.toLocaleString()} / ${geography.totalFacilities.toLocaleString()} facilities with geography_id · ${geography.mappedDistricts.toLocaleString()} / ${geography.refDistricts.toLocaleString()} districts (${geography.districtMapPct}%)`}
          accent="border-l-teal-500"
          onAction={() => onGoToTab('geography')}
          actionLabel="Map coverage"
        />
        <ImprovementCard
          title="Virtue match rate"
          value={virtueLink ? `${virtueLink.matchPct}%` : '—'}
          sub={
            virtueLink
              ? `${virtueLink.matchedRows.toLocaleString()} / ${virtueLink.totalRows.toLocaleString()} Virtue rows linked to another registry · ${links.approvedPairs.toLocaleString()} pairs approved`
              : `${links.approvedPairs.toLocaleString()} cross-source pairs approved`
          }
          accent="border-l-emerald-500"
          onAction={() => onGoToTab('duplicates')}
          actionLabel="Review matches"
        />
        <ImprovementCard
          title="Flags resolved"
          value={flags.totalResolved.toLocaleString()}
          sub={`${flags.totalOpen.toLocaleString()} still open across missing URLs, low confidence, contradictions, and duplicate pairs`}
          accent="border-l-blue-500"
          onAction={() => onGoToTab('flags')}
          actionLabel="View open flags"
        />
        <ImprovementCard
          title="Website addresses fixed"
          value={websiteUrls.totalUpdates.toLocaleString()}
          sub={`${websiteUrls.urlsAdded.toLocaleString()} URLs added · ${websiteUrls.currentCoveragePct}% coverage (${websiteUrls.missingUrls.toLocaleString()} still missing)`}
          accent="border-l-amber-500"
          onAction={() => onGoToTab('urls')}
          actionLabel="Fix missing URLs"
        />
      </div>

      <CrossSourceMatchSection
        links={links}
        recentMatches={data.recentMerges}
        onReview={() => onGoToTab('duplicates')}
      />

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="gift-elevate rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold">Flag resolution</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Resolved vs still open by type</p>
          </div>
          <div className="p-4">
            <TypeBreakdown resolved={flags.resolvedByType} open={flags.openByType} labels={FLAG_LABEL} />
            {data.recentResolvedFlags.length > 0 ? (
              <div className="mt-4 pt-4 border-t">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Recent fixes
                </h3>
                <ul className="space-y-2 text-xs">
                  {data.recentResolvedFlags.map((f) => (
                    <li key={f.id}>
                      <Link to={`/facility/${encodeURIComponent(f.facilityId)}`} className="font-medium hover:underline">
                        {f.facilityName || f.facilityId}
                      </Link>
                      <div className="text-muted-foreground">
                        {FLAG_LABEL[f.flagType] ?? f.flagType}
                        {f.resolvedBy ? ` · ${f.resolvedBy}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        <section className="gift-elevate rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold">Website addresses</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {websiteUrls.manualUpdates} manual · {websiteUrls.backfillUpdates} auto-backfill
            </p>
          </div>
          <div className="p-4 space-y-3">
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="text-xs text-muted-foreground">Current URL coverage</div>
              <div className="text-2xl font-bold tabular-nums">{websiteUrls.currentCoveragePct}%</div>
              <div className="text-xs text-muted-foreground mt-1">
                {websiteUrls.withUrl.toLocaleString()} facilities with a website address
              </div>
            </div>
            {data.recentUrlUpdates.length === 0 ? (
              <p className="text-xs text-muted-foreground">No URL updates yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {data.recentUrlUpdates.map((u) => (
                  <li key={u.id} className="border-b last:border-0 pb-2">
                    <Link to={`/facility/${encodeURIComponent(u.facilityId)}`} className="font-medium hover:underline">
                      {u.facilityName || u.facilityId}
                    </Link>
                    <div className="text-muted-foreground truncate">
                      {u.oldUrl ? `${u.oldUrl} → ` : ''}
                      <span className="text-primary">{u.newUrl}</span>
                    </div>
                    <div className="text-muted-foreground">{u.reviewedBy}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
