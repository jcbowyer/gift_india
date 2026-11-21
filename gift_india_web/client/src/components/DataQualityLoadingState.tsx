import { useEffect, useState, type ElementType } from 'react';
import { Skeleton } from '@databricks/appkit-ui/react';
import { Database, Flag, GitMerge, Globe, Loader2, MapPin } from 'lucide-react';
import { cn } from '../lib/utils';

type WorkspaceTab = 'summary' | 'geography' | 'urls' | 'duplicates' | 'flags';

interface LoadingStep {
  icon: ElementType;
  label: string;
}

const PAGE_STEPS: LoadingStep[] = [
  { icon: Database, label: 'Loading facility spine from Lakehouse…' },
  { icon: MapPin, label: 'Aggregating geography linkage…' },
  { icon: Globe, label: 'Computing URL coverage by state…' },
  { icon: GitMerge, label: 'Indexing Splink merge candidates…' },
];

const PANEL_STEPS: Record<'summary' | 'duplicates' | 'flags', LoadingStep[]> = {
  summary: [
    { icon: Flag, label: 'Tallying resolved quality flags…' },
    { icon: GitMerge, label: 'Loading merge audit trail…' },
    { icon: Globe, label: 'Summarizing website corrections…' },
    { icon: MapPin, label: 'Measuring geography coverage…' },
  ],
  duplicates: [
    { icon: GitMerge, label: 'Running Splink probabilistic linkage…' },
    { icon: Database, label: 'Scoring cross-source match pairs…' },
    { icon: Flag, label: 'Loading pending merge reviews…' },
  ],
  flags: [
    { icon: Flag, label: 'Loading automated quality flags…' },
    { icon: Database, label: 'Grouping by severity and type…' },
  ],
};

const WORKSPACE_TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'geography', label: 'Geography & map' },
  { id: 'urls', label: 'Website addresses' },
  { id: 'duplicates', label: 'Duplicate finder' },
  { id: 'flags', label: 'Automated flags' },
];

function useLoadingProgress(stepCount: number, stepMs = 2200) {
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(10);

  useEffect(() => {
    const stepTimer = window.setInterval(() => {
      setStepIndex((i) => (i + 1) % stepCount);
    }, stepMs);
    const progressTimer = window.setInterval(() => {
      setProgress((p) => (p >= 92 ? p : Math.min(92, p + Math.random() * 5 + 2)));
    }, 550);
    return () => {
      window.clearInterval(stepTimer);
      window.clearInterval(progressTimer);
    };
  }, [stepCount, stepMs]);

  return { stepIndex, progress };
}

function LoadingHero({
  steps,
  stepIndex,
  progress,
  compact = false,
}: {
  steps: LoadingStep[];
  stepIndex: number;
  progress: number;
  compact?: boolean;
}) {
  const step = steps[stepIndex];
  const Icon = step.icon;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-teal-50/40 shadow-sm',
        compact ? 'px-5 py-6' : 'px-6 py-8 sm:px-8 sm:py-10',
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-teal-200/30 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-12 -left-8 h-36 w-36 rounded-full bg-emerald-200/25 blur-3xl"
        aria-hidden
      />

      <div className="relative flex flex-col items-center text-center">
        <div className="relative mb-5">
          <div
            className="absolute inset-0 animate-ping rounded-full bg-teal-400/20"
            style={{ animationDuration: '2.4s' }}
            aria-hidden
          />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-teal-200/80 bg-gradient-to-br from-teal-50 to-emerald-100 shadow-inner">
            <Loader2 className="h-8 w-8 animate-spin text-teal-700" aria-hidden />
          </div>
          <div className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-white shadow-sm">
            <Icon className="h-4 w-4 text-teal-700" aria-hidden />
          </div>
        </div>

        <p className="text-sm font-semibold text-foreground sm:text-base">Preparing data quality workspace</p>
        <p className="mt-2 min-h-[2.5rem] max-w-md text-sm text-muted-foreground transition-opacity duration-300">
          {step.label}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/80">
          Step {stepIndex + 1} of {steps.length}
        </p>

        <div className="mt-5 h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-500 via-emerald-500 to-teal-600 transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="gift-elevate rounded-xl border bg-card p-4 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

function GeographySkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
      <div className="gift-elevate rounded-xl border bg-card overflow-hidden">
        <div className="border-b px-4 py-3">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="gift-elevate rounded-xl border bg-card overflow-hidden">
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="space-y-2 p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded" />
        ))}
      </div>
    </div>
  );
}

export function DataQualityPageLoading({ activeTab = 'summary' }: { activeTab?: WorkspaceTab }) {
  const { stepIndex, progress } = useLoadingProgress(PAGE_STEPS.length);

  return (
    <div className="mx-auto max-w-6xl space-y-6" aria-busy="true">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Data Quality</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track geography linkage, Splink dedupe, quality flags, and website corrections — human review before
          anything lands in gold.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-0">
        {WORKSPACE_TABS.map(({ id, label }) => (
          <span
            key={id}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              id === activeTab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground/60',
            )}
          >
            {label}
          </span>
        ))}
      </div>

      <LoadingHero steps={PAGE_STEPS} stepIndex={stepIndex} progress={progress} />

      {activeTab === 'geography' ? (
        <GeographySkeleton />
      ) : activeTab === 'urls' ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
          <TableSkeleton />
        </>
      ) : activeTab === 'duplicates' || activeTab === 'flags' ? (
        <TableSkeleton rows={10} />
      ) : (
        <>
          <SummarySkeleton />
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-xl" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function DataQualityPanelLoading({
  variant,
}: {
  variant: 'summary' | 'duplicates' | 'flags';
}) {
  const steps = PANEL_STEPS[variant];
  const { stepIndex, progress } = useLoadingProgress(steps.length, 1800);

  return (
    <div className="space-y-4" aria-busy="true">
      <LoadingHero steps={steps} stepIndex={stepIndex} progress={progress} compact />
      {variant === 'summary' ? (
        <>
          <SummarySkeleton />
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-xl" />
            ))}
          </div>
        </>
      ) : (
        <TableSkeleton rows={variant === 'duplicates' ? 10 : 7} />
      )}
    </div>
  );
}
