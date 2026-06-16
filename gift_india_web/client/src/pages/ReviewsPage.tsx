import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Skeleton,
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import { Trash2, ArrowRight, PencilLine, ShieldCheck } from 'lucide-react';
import { api, SIGNAL_META, type OverrideRecord, type TrustSignal, type MergeReviewRecord, type WebsiteUrlUpdateRecord } from '../lib/api';
import { SignalBadge } from '../components/trust';

const CAP_LABEL: Record<string, string> = {
  icu: 'ICU',
  maternity: 'Maternity',
  emergency: 'Emergency',
  oncology: 'Oncology',
  trauma: 'Trauma',
  nicu: 'NICU',
};

function asSignal(s: string): TrustSignal {
  return (s in SIGNAL_META ? s : 'no_claim') as TrustSignal;
}

export function ReviewsPage() {
  const [reviews, setReviews] = useState<OverrideRecord[]>([]);
  const [mergeReviews, setMergeReviews] = useState<MergeReviewRecord[]>([]);
  const [urlUpdates, setUrlUpdates] = useState<WebsiteUrlUpdateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.overrides(), api.mergeReviews(), api.websiteUrlUpdates()])
      .then(([rows, merges, urls]) => {
        if (!active) return;
        setReviews(rows);
        setMergeReviews(merges);
        setUrlUpdates(urls);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load reviews');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const remove = async (id: number) => {
    try {
      await api.deleteOverride(id);
      setReviews((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete review');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <PencilLine className="h-6 w-6" />
        </span>
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-foreground">My reviews</h2>
          <p className="text-muted-foreground">
            Human-in-the-loop decisions — capability overrides, Splink merge reviews, and website URL updates on record.
          </p>
        </div>
      </div>

      {error && <div className="rounded-md bg-destructive/10 p-3 text-destructive">{error}</div>}

      <Card className="gift-elevate gift-fade-in" data-demo="reviews">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" /> Override log
              </CardTitle>
              <CardDescription>Human judgement layered over the evidence-based signals.</CardDescription>
            </div>
            {!loading && reviews.length > 0 && (
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                {reviews.length} override{reviews.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : reviews.length === 0 ? (
            <Empty className="gift-fade-in">
              <EmptyHeader>
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <PencilLine className="h-6 w-6" />
                </span>
                <EmptyTitle>No reviews yet</EmptyTitle>
                <EmptyDescription>
                  Open a facility on the Trust Gauge, expand a capability, and “Override assessment”.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Facility</TableHead>
                  <TableHead>Capability</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to={`/facility/${encodeURIComponent(r.facility_id)}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.facility_name || r.facility_id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{CAP_LABEL[r.capability] ?? r.capability}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <SignalBadge signal={asSignal(r.original_signal)} />
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                          <SignalBadge signal={asSignal(r.override_signal)} />
                        </div>
                        {(r.original_score != null || r.override_score != null) && (
                          <div className="text-xs tabular-nums text-muted-foreground">
                            score{' '}
                            {r.original_score != null ? Math.round(r.original_score * 100) : '—'} →{' '}
                            {r.override_score != null ? Math.round(r.override_score * 100) : '—'}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs text-sm text-muted-foreground">
                      {r.note || <span className="italic">—</span>}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void remove(r.id)}
                        aria-label="Delete review"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="gift-elevate gift-fade-in" data-demo="merge-reviews">
        <CardHeader>
          <CardTitle>Merge reviews</CardTitle>
          <CardDescription>Splink duplicate-finder recommendations you approved or rejected.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-10 w-full rounded" />
          ) : mergeReviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No merge reviews yet — use Data Quality → Duplicate finder.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pair</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mergeReviews.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">
                      <div>{r.leftName} ({r.leftSource})</div>
                      <div className="text-muted-foreground">↔ {r.rightName} ({r.rightSource})</div>
                    </TableCell>
                    <TableCell className="tabular-nums">{Math.round(r.matchProbability * 100)}%</TableCell>
                    <TableCell className="capitalize font-medium">{r.decision}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.note || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="gift-elevate gift-fade-in" data-demo="url-updates">
        <CardHeader>
          <CardTitle>Website URL updates</CardTitle>
          <CardDescription>Missing-finder URL corrections applied to bronze.facilities_virtue.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-10 w-full rounded" />
          ) : urlUpdates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No URL updates yet — use Data Quality → Web addresses.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Facility</TableHead>
                  <TableHead>URL change</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {urlUpdates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link to={`/facility/${encodeURIComponent(r.facilityId)}`} className="font-medium text-primary hover:underline">
                        {r.facilityName || r.facilityId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="text-muted-foreground line-through">{r.oldUrl || '(none)'}</div>
                      <a href={r.newUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {r.newUrl}
                      </a>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.note || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
