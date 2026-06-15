import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import {
  Card,
  CardContent,
  CardTitle,
  Skeleton,
  Badge,
  Alert,
  AlertTitle,
  AlertDescription,
} from '@databricks/appkit-ui/react';
import { ArrowLeft, MapPin, Building2, Globe, ChevronDown, ChevronRight } from 'lucide-react';
import { api, type FacilityDetail, type TrustSignal } from '../lib/api';
import { SignalBadge, CapabilityEvidence } from '../components/trust';

export function FacilityPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<FacilityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCap, setOpenCap] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, TrustSignal>>({});

  useEffect(() => {
    if (!id) return;
    api
      .facility(id)
      .then((d) => {
        setDetail(d);
        const firstWithClaim = d.capabilities.find((c) => c.trustSignal !== 'no_claim');
        setOpenCap(firstWithClaim?.key ?? d.capabilities[0]?.key ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load facility'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Trust Desk
        </Link>
        <Alert variant="destructive">
          <AlertTitle>Facility not available</AlertTitle>
          <AlertDescription>{error ?? 'Not found'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const f = detail.facility;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Trust Desk
      </Link>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold text-foreground">{f.name}</h2>
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
            </div>
            {f.matchConfidence !== null && (
              <Badge variant="outline">entity-match {Math.round(f.matchConfidence * 100)}%</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Capability assessments
        </h3>
        <div className="space-y-3">
          {detail.capabilities.map((cap) => {
            const open = openCap === cap.key;
            const effective = overrides[cap.key] ?? cap.overrideSignal ?? cap.trustSignal;
            return (
              <Card key={cap.key} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenCap(open ? null : cap.key)}
                  className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <CardTitle className="flex-1 text-base">{cap.label}</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {cap.evidenceCount} citation{cap.evidenceCount === 1 ? '' : 's'}
                  </span>
                  <SignalBadge signal={effective} />
                </button>
                {open && (
                  <CardContent className="border-t bg-muted/20 pt-4">
                    <CapabilityEvidence
                      cap={cap}
                      facilityId={f.facilityId}
                      onSaved={(sig) => setOverrides((prev) => ({ ...prev, [cap.key]: sig }))}
                    />
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
