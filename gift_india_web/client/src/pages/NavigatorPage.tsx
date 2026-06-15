import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Textarea,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
  Badge,
  Progress,
  Skeleton,
  Alert,
  AlertTitle,
  AlertDescription,
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  Input,
} from '@databricks/appkit-ui/react';
import { MapPin, Sparkles, Save, Check, Users, TrendingUp } from 'lucide-react';
import {
  api,
  parseTeamDescription,
  formatNumber,
  type Recommendation,
  type RuralPreference,
  type Specialty,
} from '../lib/api';

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{Math.round(value * 100)}</span>
      </div>
      <Progress value={value * 100} className="h-1.5" />
    </div>
  );
}

function RecommendationCard({
  rec,
  specialty,
  onSave,
  saved,
}: {
  rec: Recommendation;
  specialty: string;
  onSave: (rec: Recommendation) => void;
  saved: boolean;
}) {
  const isDesert = rec.specFacilities === 0;
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-stretch">
          <div className="flex flex-col items-center justify-center bg-primary/10 px-4 py-5 min-w-[84px]">
            <span className="text-3xl font-bold text-primary tabular-nums">{rec.score}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">match</span>
          </div>
          <div className="flex-1 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">#{rec.rank}</span>
                  <h3 className="font-semibold text-foreground flex items-center gap-1">
                    <MapPin className="h-4 w-4 text-primary" /> {rec.district}
                  </h3>
                </div>
                <p className="text-sm text-muted-foreground">{rec.state}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 justify-end">
                {isDesert ? (
                  <Badge variant="destructive">Medical desert · 0 {specialty} teams</Badge>
                ) : (
                  <Badge variant="secondary">{rec.specFacilities} existing {specialty} site{rec.specFacilities === 1 ? '' : 's'}</Badge>
                )}
                <Badge variant="outline">{rec.urbanity < 0.4 ? 'Rural' : rec.urbanity > 0.7 ? 'Urban' : 'Mixed'}</Badge>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> {formatNumber(rec.population)} people
              </span>
              {rec.csectionPct !== null && (
                <span className="text-muted-foreground">C-section rate: {rec.csectionPct.toFixed(1)}%</span>
              )}
              {rec.institutionalBirthPct !== null && (
                <span className="text-muted-foreground">Institutional births: {rec.institutionalBirthPct.toFixed(1)}%</span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 pt-1">
              <ScoreBar label="Unmet need" value={rec.needScore} />
              <ScoreBar label="Capacity gap" value={rec.gapScore} />
              <ScoreBar label="Population reach" value={rec.reachScore} />
            </div>

            <div className="pt-1">
              <Button
                size="sm"
                variant={saved ? 'secondary' : 'outline'}
                onClick={() => onSave(rec)}
                disabled={saved}
              >
                {saved ? <><Check className="h-4 w-4" /> Saved to plan</> : <><Save className="h-4 w-4" /> Save placement</>}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function NavigatorPage() {
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [description, setDescription] = useState('3-surgeon cataract team, 5 days, willing to travel rural');
  const [specialty, setSpecialty] = useState('Cataract / Ophthalmology');
  const [ruralPreference, setRuralPreference] = useState<RuralPreference>('rural');
  const [teamSize, setTeamSize] = useState(3);
  const [days, setDays] = useState(5);

  const [results, setResults] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.specialties().then(setSpecialties).catch(() => undefined);
  }, []);

  const applyDescription = () => {
    const parsed = parseTeamDescription(description);
    if (parsed.specialty) setSpecialty(parsed.specialty);
    if (parsed.teamSize) setTeamSize(parsed.teamSize);
    if (parsed.days) setDays(parsed.days);
    if (parsed.ruralPreference) setRuralPreference(parsed.ruralPreference);
  };

  const runSearch = async () => {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await api.recommend({ specialty, ruralPreference, teamSize, days, limit: 12 });
      setResults(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute recommendations');
    } finally {
      setLoading(false);
    }
  };

  const savePlan = async (rec: Recommendation) => {
    const key = `${rec.district}|${rec.state}`;
    try {
      await api.savePlan({
        teamLabel: description.trim() || `${teamSize}-person ${specialty} team`,
        specialty,
        ruralPreference,
        teamSize,
        days,
        district: rec.district,
        state: rec.state,
        score: rec.score,
        population: rec.population,
      });
      setSavedIds((prev) => new Set(prev).add(key));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save plan');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-foreground">Where should this team go?</h2>
        <p className="text-muted-foreground">
          Describe a visiting surgical team. gift_india ranks the districts where it will close the largest surgical-care gap,
          using live facility and health data synced into Lakebase.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Describe your team</CardTitle>
          <CardDescription>Type a plain-language description, or set the parameters directly.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='e.g. "3-surgeon cataract team, 5 days, willing to travel rural"'
              rows={2}
            />
            <div>
              <Button variant="outline" size="sm" onClick={applyDescription}>
                <Sparkles className="h-4 w-4" /> Parse description
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Specialty</Label>
              <Select value={specialty} onValueChange={setSpecialty}>
                <SelectTrigger>
                  <SelectValue placeholder="Select specialty" />
                </SelectTrigger>
                <SelectContent>
                  {specialties.map((s) => (
                    <SelectItem key={s.specialty} value={s.specialty}>
                      {s.specialty}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="teamSize">Surgeons</Label>
              <Input
                id="teamSize"
                type="number"
                min={1}
                max={50}
                value={teamSize}
                onChange={(e) => setTeamSize(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="days">Days on site</Label>
              <Input
                id="days"
                type="number"
                min={1}
                max={60}
                value={days}
                onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1.5">
              <Label>Travel preference</Label>
              <ToggleGroup
                type="single"
                value={ruralPreference}
                onValueChange={(v) => v && setRuralPreference(v as RuralPreference)}
                variant="outline"
              >
                <ToggleGroupItem value="rural">Rural</ToggleGroupItem>
                <ToggleGroupItem value="any">Anywhere</ToggleGroupItem>
                <ToggleGroupItem value="urban">Urban</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Button onClick={runSearch} disabled={loading} size="lg">
              <TrendingUp className="h-4 w-4" /> {loading ? 'Ranking districts…' : 'Recommend placements'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={`s-${i}`} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && !error && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No districts matched</EmptyTitle>
            <EmptyDescription>Try widening the travel preference to “Anywhere”.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Top {results.length} placements for a <span className="font-medium text-foreground">{specialty}</span> team
            ({ruralPreference === 'any' ? 'any location' : `${ruralPreference} focus`}).
          </p>
          {results.map((rec) => (
            <RecommendationCard
              key={`${rec.district}|${rec.state}`}
              rec={rec}
              specialty={specialty}
              onSave={savePlan}
              saved={savedIds.has(`${rec.district}|${rec.state}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
