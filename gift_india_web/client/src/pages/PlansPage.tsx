import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Skeleton,
  Badge,
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
import { Trash2 } from 'lucide-react';
import { api, formatNumber, type PlacementPlan } from '../lib/api';

export function PlansPage() {
  const [plans, setPlans] = useState<PlacementPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .plans()
      .then(setPlans)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load plans'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async (id: number) => {
    try {
      await api.deletePlan(id);
      setPlans((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete plan');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-foreground">Saved placement plans</h2>
        <p className="text-muted-foreground">
          Placements you saved from the Navigator. These are written to your app’s Lakebase Postgres database.
        </p>
      </div>

      {error && (
        <div className="text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your plans</CardTitle>
          <CardDescription>Stored in <code>app.placement_plans</code> on Lakebase.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : plans.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No saved plans yet</EmptyTitle>
                <EmptyDescription>Use the Navigator to rank districts, then “Save placement”.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>District</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Specialty</TableHead>
                  <TableHead className="text-right">Match</TableHead>
                  <TableHead className="text-right">People</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{p.district}</div>
                      <div className="text-xs text-muted-foreground">{p.state}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.team_size}-surgeon · {p.days}d · {p.rural_preference}
                    </TableCell>
                    <TableCell className="text-sm">{p.specialty}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{Number(p.score)}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                      {p.population ? formatNumber(Number(p.population)) : '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(p.id)}
                        aria-label="Delete plan"
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
    </div>
  );
}
