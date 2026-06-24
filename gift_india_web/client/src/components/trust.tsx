import { useState, type ComponentType } from 'react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Textarea,
  Label,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@databricks/appkit-ui/react';
import {
  CheckCircle2,
  XCircle,
  ExternalLink,
  PencilLine,
  Check,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Globe,
  FileText,
  Link2,
  BadgeCheck,
  Quote,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  UserCheck,
} from 'lucide-react';
import {
  SIGNAL_META,
  DEFAULT_SCORE_FOR_SIGNAL,
  effectiveTrustScore,
  narrationAttribution,
  humanReviewStatusForCapability,
  type TrustSignal,
  type CapabilityDetail,
  type EvidenceItem,
  type HumanReviewStatus,
} from '../lib/api';

/** Per-signal lucide icon + solid colour family for the prominent trust badges. */
const SIGNAL_ICON: Record<TrustSignal, ComponentType<{ className?: string }>> = {
  strong: ShieldCheck,
  partial: ShieldQuestion,
  weak_suspicious: ShieldAlert,
  no_claim: ShieldQuestion,
};

/** Saturated badge tones for the big "trust everywhere" treatment. */
const SIGNAL_SOLID: Record<TrustSignal, string> = {
  strong: 'bg-emerald-600 text-white border-emerald-700 shadow-emerald-600/20',
  partial: 'bg-amber-500 text-white border-amber-600 shadow-amber-500/20',
  weak_suspicious: 'bg-red-600 text-white border-red-700 shadow-red-600/20',
  no_claim: 'bg-slate-400 text-white border-slate-500 shadow-slate-400/20',
};

export function SignalBadge({
  signal,
  size = 'sm',
  className = '',
}: {
  signal: TrustSignal;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const meta = SIGNAL_META[signal];
  const Icon = SIGNAL_ICON[signal];
  if (size === 'lg') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold shadow-sm ${SIGNAL_SOLID[signal]} ${className}`}
      >
        <Icon className="h-4 w-4" />
        {meta.label}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.tone} ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}

/** Compact flag for list rows and capability headers. */
export function HumanReviewBadge({
  className = '',
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-400/80 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-950 shadow-sm ${className}`}
      title="Manual human review recommended"
    >
      <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" aria-hidden />
      {compact ? 'Review' : 'Needs human review'}
    </span>
  );
}

/** Prominent callout when AI or pipeline flags a claim for planner confirmation. */
export function HumanReviewCallout({
  status,
  onReview,
  className = '',
}: {
  status: HumanReviewStatus;
  onReview?: () => void;
  className?: string;
}) {
  if (!status.recommended) return null;
  return (
    <div
      className={`rounded-lg border border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 px-3.5 py-3 text-sm text-amber-950 shadow-sm ${className}`}
      role="status"
      data-demo="human-review-flag"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <UserCheck className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold leading-snug">Manual human review recommended</p>
          {status.reason ? (
            <p className="text-amber-900/90 leading-relaxed">{status.reason}</p>
          ) : null}
          <p className="text-xs text-amber-800/80">
            Automated evidence can surface conflicts and thin claims — a planner should confirm with local ground
            truth before relying on this score.
          </p>
        </div>
        {onReview ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5 border-amber-400 bg-white font-semibold text-amber-950 hover:bg-amber-100/80"
            onClick={onReview}
          >
            <PencilLine className="h-4 w-4" />
            Start review
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function TrustScoreDial({
  score,
  signal,
  size = 'md',
}: {
  score: number;
  signal: TrustSignal;
  size?: 'md' | 'lg';
}) {
  const pct = Math.round(score * 100);
  const meta = SIGNAL_META[signal];
  const ring =
    signal === 'strong'
      ? 'text-emerald-500'
      : signal === 'partial'
        ? 'text-amber-500'
        : signal === 'weak_suspicious'
          ? 'text-red-500'
          : 'text-muted-foreground/40';
  const box = size === 'lg' ? 'h-[4.5rem] w-[4.5rem]' : 'h-14 w-14';
  const num = size === 'lg' ? 'text-xl' : 'text-base';
  return (
    <div className={`flex flex-col items-center justify-center ${size === 'lg' ? 'min-w-[88px]' : 'min-w-[76px]'}`}>
      <div className={`relative ${box}`}>
        <svg viewBox="0 0 36 36" className={`${box} -rotate-90`}>
          <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-muted" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            className={`${ring} stroke-current`}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 97.4} 97.4`}
          />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center ${num} font-bold tabular-nums text-foreground`}>
          {pct}
        </span>
      </div>
      <span className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{meta.short}</span>
    </div>
  );
}

/** Evidence source-type → presentation (real source kinds from the gold pipeline). */
const SOURCE_META: Record<string, { label: string; icon: ComponentType<{ className?: string }>; tone: string }> = {
  website_crawl: { label: 'Website verified', icon: Globe, tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  facility_record: { label: 'Registry record', icon: FileText, tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  entity_resolution: { label: 'Entity-matched', icon: Link2, tone: 'bg-slate-50 text-slate-600 border-slate-200' },
};

function sourceMeta(sourceType: string) {
  return SOURCE_META[sourceType] ?? { label: sourceType.replace(/_/g, ' '), icon: BadgeCheck, tone: 'bg-slate-50 text-slate-600 border-slate-200' };
}

/**
 * "Best evidence" highlight chip — surfaces the strongest source backing a claim
 * (the JCI-style trust marker, driven by the real bestSource string).
 */
export function BestSourceBadge({ source, className = '' }: { source: string; className?: string }) {
  if (!source) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ${className}`}
    >
      <BadgeCheck className="h-3.5 w-3.5 text-amber-600" />
      {source}
    </span>
  );
}

function EvidenceRow({ e }: { e: EvidenceItem }) {
  const supports = e.stance === 'supports';
  const sm = sourceMeta(e.sourceType);
  const SourceIcon = sm.icon;
  return (
    <li
      className={`flex gap-3 rounded-lg border bg-card p-3 ${
        supports ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-red-500'
      }`}
    >
      <span className={`mt-0.5 ${supports ? 'text-emerald-600' : 'text-red-600'}`}>
        {supports ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start gap-2">
          <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          <p className="text-sm leading-snug text-foreground">{e.snippet}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium ${sm.tone}`}>
            <SourceIcon className="h-3 w-3" /> {e.sourceLabel || sm.label}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> reliability {Math.round(e.weight * 100)}%
          </span>
          {e.observedAt && <span>{e.observedAt}</span>}
          {e.sourceUrl && (
            <a
              href={e.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              source <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

const SIGNAL_OPTIONS: TrustSignal[] = ['strong', 'partial', 'weak_suspicious', 'no_claim'];

const SIGNAL_PICKER: Record<
  TrustSignal,
  { ring: string; selected: string; hover: string }
> = {
  strong: {
    ring: 'ring-emerald-500',
    selected: 'border-emerald-600 bg-emerald-600 text-white shadow-md shadow-emerald-600/25',
    hover: 'hover:border-emerald-500 hover:bg-emerald-50',
  },
  partial: {
    ring: 'ring-amber-500',
    selected: 'border-amber-500 bg-amber-500 text-white shadow-md shadow-amber-500/25',
    hover: 'hover:border-amber-400 hover:bg-amber-50',
  },
  weak_suspicious: {
    ring: 'ring-red-500',
    selected: 'border-red-600 bg-red-600 text-white shadow-md shadow-red-600/25',
    hover: 'hover:border-red-500 hover:bg-red-50',
  },
  no_claim: {
    ring: 'ring-slate-400',
    selected: 'border-slate-500 bg-slate-500 text-white shadow-md shadow-slate-500/25',
    hover: 'hover:border-slate-400 hover:bg-slate-50',
  },
};

function OverrideAssessmentDialog({
  open,
  onOpenChange,
  cap,
  facilityId,
  facilityName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cap: CapabilityDetail;
  facilityId: string;
  facilityName?: string;
  onSaved?: (signal: TrustSignal | null, note: string, score: number | null) => void;
}) {
  const systemSignal = cap.trustSignal;
  const systemScore = cap.trustScore;
  const [signal, setSignal] = useState<TrustSignal>(cap.overrideSignal ?? cap.trustSignal);
  const [scorePct, setScorePct] = useState(
    Math.round((cap.overrideScore ?? cap.trustScore) * 100),
  );
  const [note, setNote] = useState(cap.overrideNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setSignal(cap.overrideSignal ?? cap.trustSignal);
    setScorePct(Math.round((cap.overrideScore ?? cap.trustScore) * 100));
    setNote(cap.overrideNote ?? '');
    setError(null);
  };

  const pickSignal = (next: TrustSignal) => {
    setSignal(next);
    if (cap.overrideScore == null) {
      setScorePct(Math.round(DEFAULT_SCORE_FOR_SIGNAL[next] * 100));
    }
  };

  const save = async () => {
    const trimmed = note.trim();
    if (!trimmed) {
      setError('Add a qualitative reviewer note — e.g. phone confirmation, inspection, registry update.');
      return;
    }
    const overrideScore = scorePct / 100;
    const hasExistingOverride = cap.overrideSignal != null || cap.overrideScore != null;
    const unchanged =
      signal === systemSignal && Math.abs(overrideScore - systemScore) < 0.005;
    if (unchanged && !hasExistingOverride) {
      setError('Change the trust signal or score from the computed assessment, or edit an existing review.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { api } = await import('../lib/api');
      const saved = await api.saveOverride({
        facilityId,
        capability: cap.key,
        overrideSignal: signal,
        overrideScore,
        note: trimmed,
      });
      if (saved) onSaved?.(signal, trimmed, overrideScore);
      else onSaved?.(null, '', null);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save review');
    } finally {
      setSaving(false);
    }
  };

  const systemScorePct = Math.round(systemScore * 100);
  const humanReview = humanReviewStatusForCapability(cap);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetForm();
        onOpenChange(next);
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg" data-demo="override-dialog">
        <DialogHeader className="border-b bg-muted/30 px-6 py-5">
          <DialogTitle className="text-xl">Override assessment</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {facilityName ? (
              <>
                <span className="font-medium text-foreground">{facilityName}</span>
                {' · '}
              </>
            ) : null}
            {cap.label} — your judgement layers on top of the computed evidence and saves to{' '}
            <span className="font-medium text-foreground">My Reviews</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          {humanReview.recommended ? (
            <HumanReviewCallout status={humanReview} />
          ) : null}

          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
            <span className="text-muted-foreground">Computed</span>
            <SignalBadge signal={systemSignal} />
            <span className="text-muted-foreground">· score {systemScorePct}</span>
            {cap.evidenceTier && <span className="text-muted-foreground">· {cap.evidenceTier}</span>}
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-foreground">Your override</span>
            <SignalBadge signal={signal} size="lg" />
            <span className="text-muted-foreground">· score {scorePct}</span>
          </div>

          {cap.assessmentJson && !cap.overrideSignal && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
              <EvidenceNarrationAttribution
                model={cap.assessmentModel}
                narratedAt={cap.assessmentNarratedAt}
              />
              <div>
                <span className="font-semibold">Agent assessment:</span> {cap.assessmentJson.verdict}
                {cap.assessmentJson.rationale && (
                  <p className="mt-1 text-amber-900/90">{cap.assessmentJson.rationale}</p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Set trust signal</Label>
            <div className="grid grid-cols-2 gap-2">
              {SIGNAL_OPTIONS.map((s) => {
                const meta = SIGNAL_META[s];
                const Icon = SIGNAL_ICON[s];
                const active = signal === s;
                const tone = SIGNAL_PICKER[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => pickSignal(s)}
                    className={`flex items-center gap-2 rounded-xl border-2 px-3 py-3 text-left text-sm font-semibold transition-all ${
                      active ? `${tone.selected} ring-2 ${tone.ring}` : `border-border bg-background ${tone.hover}`
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`override-score-${cap.key}`} className="text-sm font-semibold">
                Set trust score
              </Label>
              <span className="text-sm font-bold tabular-nums text-foreground">{scorePct} / 100</span>
            </div>
            <input
              id={`override-score-${cap.key}`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={scorePct}
              onChange={(e) => setScorePct(Number(e.target.value))}
              className="h-2 w-full cursor-pointer accent-primary"
            />
            <p className="text-xs text-muted-foreground">
              Computed score was {systemScorePct}. Adjust to reflect your ground-truth judgement.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`override-note-${cap.key}`} className="text-sm font-semibold">
              Qualitative reviewer note <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id={`override-note-${cap.key}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why are you overriding? e.g. Confirmed by phone with the district health officer — 2 ICU beds operational; site visit 12 Jun; registry updated."
              rows={4}
              className="min-h-[110px] resize-y text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Ground truth from a call, inspection, or local knowledge. Stored in My Reviews for audit.
            </p>
          </div>

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex-col gap-2 border-t bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={saving} className="sm:min-w-[120px]">
            Cancel
          </Button>
          <Button size="lg" onClick={() => void save()} disabled={saving || !note.trim()} className="sm:min-w-[200px]">
            <Check className="h-5 w-5" />
            {saving ? 'Saving…' : 'Save to My Reviews'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Layer 2 narration provenance — Databricks Agent Bricks model or dev stub.
 */
function EvidenceNarrationAttribution({
  model,
  narratedAt,
}: {
  model: string | null;
  narratedAt: string | null;
}) {
  const attr = narrationAttribution(model);
  if (!attr) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-sky-200/80 bg-sky-50/90 px-2.5 py-1.5 text-xs text-sky-950">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />
      <span>
        {attr.isLlm ? (
          <>
            <span className="font-semibold">AI-generated evidence analysis</span>
            <span className="text-sky-800/80"> · attributed to </span>
            <span className="font-medium">{attr.title}</span>
            {attr.modelLabel ? (
              <span className="text-sky-800/80"> ({attr.modelLabel})</span>
            ) : null}
          </>
        ) : (
          <>
            <span className="font-semibold">Pipeline template</span>
            <span className="text-sky-800/80"> — not an LLM; run </span>
            <span className="font-medium">make narrate-pilot</span>
            <span className="text-sky-800/80"> for Agent Bricks analysis</span>
          </>
        )}
      </span>
      {narratedAt ? (
        <time className="text-sky-800/65 tabular-nums" dateTime={narratedAt}>
          · {narratedAt.replace('T', ' ')}
        </time>
      ) : null}
    </div>
  );
}

/**
 * Citations + human override control for a single (facility, capability).
 * Used both inline in the ranked list and on the facility detail page.
 */
export function CapabilityEvidence({
  cap,
  facilityId,
  facilityName,
  onSaved,
  reviewOpen: reviewOpenProp,
  onReviewOpenChange,
}: {
  cap: CapabilityDetail;
  facilityId: string;
  facilityName?: string;
  onSaved?: (signal: TrustSignal | null, note: string, score: number | null) => void;
  reviewOpen?: boolean;
  onReviewOpenChange?: (open: boolean) => void;
}) {
  const [internalReviewOpen, setInternalReviewOpen] = useState(false);
  const dialogOpen = reviewOpenProp ?? internalReviewOpen;
  const setDialogOpen = onReviewOpenChange ?? setInternalReviewOpen;
  const [savedSignal, setSavedSignal] = useState<TrustSignal | null>(cap.overrideSignal);
  const [savedScore, setSavedScore] = useState<number | null>(cap.overrideScore);
  const [savedNote, setSavedNote] = useState(cap.overrideNote ?? '');
  const [justSaved, setJustSaved] = useState(false);

  const handleSaved = (signal: TrustSignal | null, note: string, score: number | null) => {
    setSavedSignal(signal);
    setSavedScore(score);
    setSavedNote(note);
    if (signal) setJustSaved(true);
    onSaved?.(signal, note, score);
  };

  const support = cap.evidence.filter((e) => e.stance === 'supports');
  const contra = cap.evidence.filter((e) => e.stance === 'contradicts');
  const assessment = cap.overrideSignal ? null : cap.assessmentJson;
  const showMd = !cap.overrideSignal && cap.assessmentMd;
  const showNarration = Boolean(showMd || assessment);
  const humanReview = humanReviewStatusForCapability(cap);

  const overrideBtnClass = humanReview.recommended
    ? 'gap-1.5 border-amber-400 bg-amber-50 font-semibold text-amber-950 shadow-sm hover:border-amber-500 hover:bg-amber-100/80'
    : 'gap-1.5 border-border bg-background font-medium text-foreground shadow-sm hover:border-primary/45 hover:bg-muted/50';

  return (
    <div className="space-y-3">
      {humanReview.recommended ? (
        <HumanReviewCallout status={humanReview} onReview={() => setDialogOpen(true)} />
      ) : null}

      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 ${
          humanReview.recommended
            ? 'border-amber-200/80 bg-amber-50/50'
            : 'border-border/80 bg-muted/30'
        }`}
        data-demo="override"
      >
        <p className="text-xs text-muted-foreground">
          {savedSignal
            ? 'You have a saved review for this claim.'
            : humanReview.recommended
              ? 'Confirm or correct this assessment with local ground truth.'
              : 'Disagree with the computed signal?'}
        </p>
        <Button variant="outline" size="sm" className={overrideBtnClass} onClick={() => setDialogOpen(true)}>
          <PencilLine className="h-4 w-4" />
          {savedSignal ? 'Edit review' : humanReview.recommended ? 'Start human review' : 'Override assessment'}
        </Button>
      </div>

      {showNarration ? (
        <EvidenceNarrationAttribution
          model={cap.assessmentModel}
          narratedAt={cap.assessmentNarratedAt}
        />
      ) : null}

      {showMd ? (
        <div className="space-y-2" data-demo="evidence-analysis">
          <div className="rounded-md border border-sky-100 bg-card px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap font-sans shadow-sm">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Evidence analysis
            </p>
            {cap.assessmentMd}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{cap.summary}</p>
      )}

      {assessment && (
        <div className="space-y-2 rounded-md border border-muted bg-muted/20 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Structured assessment (JSON):</span>
            <span>{assessment.verdict}</span>
            {cap.evidenceTier && (
              <span className="text-muted-foreground">
                · {cap.evidenceTier} ({Math.round(assessment.evidence_strength_score * 100) / 100})
              </span>
            )}
          </div>
          <p className="text-muted-foreground">{assessment.rationale}</p>
          {assessment.citations?.length > 0 && (
            <ul className="space-y-1.5">
              {assessment.citations.map((c, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-medium">{c.source}</span>
                    <span className="text-muted-foreground"> ({c.stance})</span> — {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {savedSignal && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Your review</span>
            <SignalBadge signal={savedSignal} />
            <span className="text-xs font-semibold tabular-nums text-foreground">
              score {Math.round((savedScore ?? effectiveTrustScore(cap)) * 100)}
            </span>
            {justSaved && (
              <Link to="/reviews" className="ml-auto text-xs text-primary hover:underline">
                My Reviews →
              </Link>
            )}
          </div>
          {savedNote && <p className="text-foreground/80">&ldquo;{savedNote}&rdquo;</p>}
        </div>
      )}

      {cap.evidence.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No citations on record for this capability.</p>
      ) : (
        <div className="space-y-3">
          {support.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Supporting evidence ({support.length})
              </div>
              <ul className="space-y-2">
                {support.map((e) => (
                  <EvidenceRow key={e.evidenceId} e={e} />
                ))}
              </ul>
            </div>
          )}
          {contra.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-red-600">
                Contradicting evidence ({contra.length})
              </div>
              <ul className="space-y-2">
                {contra.map((e) => (
                  <EvidenceRow key={e.evidenceId} e={e} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <OverrideAssessmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cap={cap}
        facilityId={facilityId}
        facilityName={facilityName}
        onSaved={handleSaved}
      />
    </div>
  );
}

export function EvidenceTally({
  supporting,
  contradicting,
}: {
  supporting: number;
  contradicting: number;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> {supporting} supporting
      </span>
      {contradicting > 0 && (
        <span className="inline-flex items-center gap-1 text-red-700">
          <XCircle className="h-3.5 w-3.5" /> {contradicting} contradicting
        </span>
      )}
    </div>
  );
}

export function CapabilityChipBadge({ signal, count }: { signal: TrustSignal; count: number }) {
  if (count === 0) return null;
  return (
    <Badge variant="outline" className="gap-1 text-[10px]">
      <span className={`h-1.5 w-1.5 rounded-full ${SIGNAL_META[signal].dot}`} /> {count}
    </Badge>
  );
}
