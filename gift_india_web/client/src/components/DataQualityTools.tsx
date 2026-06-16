import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Input } from '@databricks/appkit-ui/react';
import {
  api,
  type DataQualityFlag,
  type DataQualityFlagSummary,
  type DataQualityMissingFacility,
  type MergeCandidate,
} from '../lib/api';

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
    try {
      await api.saveMergeReview({ candidateId, decision, note: notes[candidateId]?.trim() || undefined });
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
    return <p className="text-sm text-muted-foreground py-6">Loading Splink merge recommendations…</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive py-6">{error}</p>;
  }

  const pending = rows.filter((r) => !r.reviewDecision || r.reviewDecision === 'defer');

  return (
    <div className="space-y-3" data-demo="duplicate-finder">
      <p className="text-sm text-muted-foreground">
        Probabilistic linkage across bronze sources via{' '}
        <code className="font-mono text-xs bg-muted px-1 rounded">Splink</code> — match scores, not silent gold merges.
        Approve or reject before MDM combines rows.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No merge candidates yet. Run <code className="font-mono text-xs">make splink-duplicates</code> against your
          warehouse.
        </p>
      ) : (
        <div className="gift-elevate rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex justify-between items-baseline">
            <h2 className="text-sm font-semibold">Merge recommendations</h2>
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
                                Approve merge
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
        <p className="text-sm text-muted-foreground">Loading flags…</p>
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

export function useDataQualityFlagSummary() {
  const [summary, setSummary] = useState<DataQualityFlagSummary | null>(null);
  useEffect(() => {
    api.dataQualityFlagSummary().then(setSummary).catch(() => setSummary(null));
  }, []);
  return summary;
}
