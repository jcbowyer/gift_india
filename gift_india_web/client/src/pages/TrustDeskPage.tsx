import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Card,
  CardContent,
  Badge,
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
} from '@databricks/appkit-ui/react';
import { ChevronDown, ChevronRight, MapPin, Building2, Search, ExternalLink } from 'lucide-react';
import {
  api,
  type Capability,
  type RegionState,
  type FacilityRanking,
  type FacilityDetail,
  type TrustSignal,
  type Stats,
} from '../lib/api';
import { SignalBadge, TrustScoreDial, EvidenceTally, CapabilityEvidence } from '../components/trust';

const SIGNAL_FILTERS: { value: TrustSignal | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'strong', label: 'Strong' },
  { value: 'partial', label: 'Partial' },
  { value: 'weak_suspicious', label: 'Suspicious' },
];

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-lg font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
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
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<FacilityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [override, setOverride] = useState<TrustSignal | null>(rec.overrideSignal);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      setLoading(true);
      try {
        setDetail(await api.facility(rec.facilityId));
      } catch {
        /* surfaced by empty state below */
      } finally {
        setLoading(false);
      }
    }
  };

  const cap = detail?.capabilities.find((c) => c.key === capabilityKey);
  const effectiveSignal = override ?? rec.trustSignal;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex w-full items-stretch gap-3 text-left transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center pl-3 text-muted-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <div className="py-3">
          <TrustScoreDial score={rec.trustScore} signal={effectiveSignal} />
        </div>
        <div className="flex-1 min-w-0 space-y-1.5 py-3 pr-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">#{rec.rank}</span>
            <h3 className="truncate font-semibold text-foreground">{rec.name}</h3>
            <SignalBadge signal={effectiveSignal} />
            {override && (
              <Badge variant="outline" className="text-[10px]">
                planner override
              </Badge>
            )}
          </div>
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
          <EvidenceTally supporting={rec.supportingCount} contradicting={rec.contradictingCount} />
        </div>
      </button>

      {open && (
        <CardContent className="border-t bg-muted/20 pt-4">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded" />
              <Skeleton className="h-16 w-full rounded" />
            </div>
          )}
          {!loading && cap && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  {cap.label} evidence for {rec.name}
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
                onSaved={(sig) => setOverride(sig)}
              />
            </div>
          )}
          {!loading && !cap && (
            <p className="text-sm text-muted-foreground">Could not load evidence for this facility.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function TrustDeskPage() {
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
    api.capabilities().then(setCapabilities).catch(() => undefined);
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
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-foreground">Facility Trust Desk</h2>
        <p className="text-muted-foreground">
          Pick a capability and region. Facilities are ranked by how well their claim is backed by evidence —
          expand any facility to read the citations and override the assessment.
        </p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatPill label="Facilities profiled" value={stats.facilities.toLocaleString()} />
          <StatPill label="Capability claims assessed" value={stats.assessed_claims.toLocaleString()} />
          <StatPill label="Strong-evidence signals" value={stats.strong.toLocaleString()} />
          <StatPill label="Citations on record" value={stats.citations.toLocaleString()} />
        </div>
      )}

      {/* Capability selector */}
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Capability</span>
        <div className="flex flex-wrap gap-2">
          {capabilities.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCapability(c.key)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                capability === c.key
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-card hover:bg-muted/50'
              }`}
            >
              <div className="text-sm font-medium">{c.label}</div>
              <div className="text-[11px] text-muted-foreground">
                {c.strong} strong · {c.weak} suspicious
              </div>
            </button>
          ))}
        </div>
        {activeCap && <p className="text-sm text-muted-foreground">{activeCap.description}</p>}
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
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No facilities found</EmptyTitle>
            <EmptyDescription>
              No facility claims {activeCap?.label ?? 'this capability'} for the selected region and filter.
              Try a different region or signal.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-3">
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
