import { useState, type ComponentType } from 'react';
import {
  Badge,
  Button,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  Label,
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
} from 'lucide-react';
import {
  SIGNAL_META,
  type TrustSignal,
  type CapabilityDetail,
  type EvidenceItem,
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
  const box = size === 'lg' ? 'h-16 w-16' : 'h-12 w-12';
  const num = size === 'lg' ? 'text-lg' : 'text-sm';
  return (
    <div className={`flex flex-col items-center justify-center ${size === 'lg' ? 'min-w-[84px]' : 'min-w-[72px]'}`}>
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
        <span className={`absolute inset-0 flex items-center justify-center ${num} font-bold tabular-nums`}>
          {pct}
        </span>
      </div>
      <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{meta.short}</span>
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

/**
 * Citations + human override control for a single (facility, capability).
 * Used both inline in the ranked list and on the facility detail page.
 */
export function CapabilityEvidence({
  cap,
  facilityId,
  onSaved,
}: {
  cap: CapabilityDetail;
  facilityId: string;
  onSaved?: (signal: TrustSignal, note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [signal, setSignal] = useState<TrustSignal>(cap.overrideSignal ?? cap.trustSignal);
  const [note, setNote] = useState(cap.overrideNote ?? '');
  const [saving, setSaving] = useState(false);
  const [savedSignal, setSavedSignal] = useState<TrustSignal | null>(cap.overrideSignal);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { api } = await import('../lib/api');
      await api.saveOverride({ facilityId, capability: cap.key, overrideSignal: signal, note: note.trim() || undefined });
      setSavedSignal(signal);
      setEditing(false);
      onSaved?.(signal, note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save review');
    } finally {
      setSaving(false);
    }
  };

  const support = cap.evidence.filter((e) => e.stance === 'supports');
  const contra = cap.evidence.filter((e) => e.stance === 'contradicts');

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{cap.summary}</p>

      {savedSignal && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <PencilLine className="h-4 w-4 text-primary" />
          <span>
            Planner override: <SignalBadge signal={savedSignal} className="ml-1 align-middle" />
          </span>
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

      <div className="pt-1">
        {!editing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <PencilLine className="h-4 w-4" /> {savedSignal ? 'Edit review' : 'Override assessment'}
          </Button>
        ) : (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="space-y-1.5">
              <Label>Set trust signal</Label>
              <ToggleGroup
                type="single"
                value={signal}
                onValueChange={(v) => v && setSignal(v as TrustSignal)}
                variant="outline"
                className="flex-wrap justify-start"
              >
                {SIGNAL_OPTIONS.map((s) => (
                  <ToggleGroupItem key={s} value={s} className="text-xs">
                    {SIGNAL_META[s].short}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`note-${cap.key}`}>Reviewer note</Label>
              <Textarea
                id={`note-${cap.key}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why are you overriding? e.g. confirmed by phone, registry updated, inspection pending…"
                rows={2}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save review'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
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
