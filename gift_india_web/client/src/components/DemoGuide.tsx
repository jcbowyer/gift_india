import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button } from '@databricks/appkit-ui/react';
import {
  Sparkles,
  X,
  ArrowRight,
  ArrowLeft,
  Play,
  CheckCircle2,
  MousePointerClick,
  Clock,
} from 'lucide-react';
import { GiftSeal } from './GiftSeal';

/**
 * Interactive 5-minute demo walkthrough — the in-app twin of DEMO.md.
 *
 * Drives the presenter through the killer-demo script: auto-navigates to the
 * right screen for each beat, narrates the talk track, spotlights the relevant
 * UI (when a `selector` is given and present), and paces against a 5:00 clock.
 *
 * Launch via the header "✨ Demo" button (window event `gift-demo:start`),
 * the floating pill, or the keyboard chord `g` then `d`. Advance with → / Space,
 * go back with ←, exit with Esc.
 */

type Phase = 'Problem' | 'Solution' | 'Why it matters' | 'Tech' | 'Future' | 'Close';

interface Step {
  phase: Phase;
  clock: string; // budgeted window, shown to the presenter
  title: string;
  route: string;
  /** Talk track — what the presenter says. */
  say: string;
  /** Concrete actions to take on screen. */
  do?: string[];
  /** Optional CSS selector to spotlight on this step (no-ops if absent). */
  selector?: string;
}

const STEPS: Step[] = [
  {
    phase: 'Problem',
    clock: '0:00 – 0:30',
    title: 'Is this ICU real — or just listed?',
    route: '/',
    say: 'NGO planners shouldn’t have to fight ten thousand rows of messy, scraped hospital data. The question that stops them cold: is this ICU real — or just *listed*? Get it wrong and a critical patient is routed somewhere that can’t help them.',
    do: ['Gesture at the hero stats: facilities, states, citations.', 'Land the line: “Every number is backed by evidence you can read.”'],
    selector: '[data-demo="hero"]',
  },
  {
    phase: 'Solution',
    clock: '0:30 – 0:55',
    title: 'Capability + region',
    route: '/',
    say: 'A planner starts the way they think: I need an ICU, in this region. No SQL, no spelunking through scraped HTML.',
    do: ['Click the ICU capability tile.', 'Pick a state in the region filter below.'],
    selector: '[data-demo="capabilities"]',
  },
  {
    phase: 'Solution',
    clock: '0:55 – 1:20',
    title: 'Ranked by evidence',
    route: '/',
    say: 'Instantly — every facility claiming an ICU here, ranked by how strongly the claim is backed. Green strong, amber partial, red suspicious. The dial is a trust score computed in our gold tables, not a vibe.',
    do: ['Point at the trust dials and the colored signal badges.'],
    selector: '[data-demo="results"]',
  },
  {
    phase: 'Solution',
    clock: '1:20 – 1:55',
    title: 'Deep dive on citations',
    route: '/',
    say: 'Open any facility and you see the receipts — the actual citations: JCI accreditation, state registry, PMJAY, the facility’s own site. Each quotes a real source field with a reliability weight. Supporting in green, contradicting in red. Nothing fabricated.',
    do: ['Expand the top (strong) result.', 'Read one supporting citation aloud.', 'Switch the filter to Suspicious; expand a red one to show contradicting evidence.'],
    selector: '[data-demo="results"]',
  },
  {
    phase: 'Solution',
    clock: '1:55 – 2:30',
    title: 'Human-in-the-loop override',
    route: '/',
    say: 'The machine isn’t the final word. A planner with ground truth — a phone call, an inspection — overrides the assessment and leaves a note. It saves to Lakebase and layers on top of the computed signal.',
    do: ['Click “Override assessment”.', 'Pick a signal; type a note (“Confirmed by phone with district health officer”).', 'Save.'],
    selector: '[data-demo="results"]',
  },
  {
    phase: 'Solution',
    clock: '2:30 – 2:45',
    title: 'An auditable trail',
    route: '/reviews',
    say: 'Every override is logged here — an auditable trail of human judgment over the evidence. Governance you can actually defend.',
    do: ['Point at the override log: original → override, with the reviewer note.'],
  },
  {
    phase: 'Why it matters',
    clock: '2:45 – 3:10',
    title: 'Where trust lives — and where it’s missing',
    route: '/navigator',
    say: 'Four things make this trustworthy: JCI as the global gold standard, an India focus on purpose, human overrides on the record, and governed data on Lakebase. On the map, zoom nation → state → district to see where trustworthy capacity exists — and where the deserts are.',
    do: ['Drill from a state into its districts.', 'Note the strong/partial/suspicious breakdown bar.'],
  },
  {
    phase: 'Why it matters',
    clock: '3:10 – 3:30',
    title: 'Benchmark into a decision',
    route: '/scorecard',
    say: 'Benchmark any district against its region and the nation — that’s how trust becomes an allocation decision, not just a dashboard.',
    do: ['Pick a district; compare its metrics against region and nation.'],
  },
  {
    phase: 'Tech',
    clock: '3:30 – 4:00',
    title: 'The stack',
    route: '/',
    say: 'Databricks AppKit for the app. Postgres Lakebase as the live serving layer the app reads, plus the override log. A dbt medallion — bronze → silver → gold — derives every trust signal in SQL; citations quote real columns. And a synthetic-to-real path: swap one loader and the exact same engine runs on governed Virtue Foundation data — nothing in the app changes.',
    do: ['Keep it tight — 30 seconds. This is the “it’s real engineering” beat.'],
  },
  {
    phase: 'Future',
    clock: '4:00 – 4:30',
    title: 'The foundation for the other tracks',
    route: '/',
    say: 'GIFT Gauge is Track 1 — can this facility do what it claims? The same trust layer feeds the rest: Medical Desert Planner (the map already shows the gaps), Referral Copilot (route to capability you trust), Data Readiness (contradicting-evidence flags are a quality signal). Trust is the foundation the other three stand on.',
    do: ['Tie in lightly — don’t over-promise.'],
  },
  {
    phase: 'Close',
    clock: '4:30 – 5:00',
    title: 'The pitch',
    route: '/',
    say: 'NGO planners drown in messy scraped data. We give them a ranked, cited, overridable answer to one question that saves lives: is this real? GIFT Gauge — Governance, Integrity & Facility Trust. We turn messy claims into trustworthy decisions.',
    do: ['Deliver the pitch line. Stop. Let it land.'],
    selector: '[data-demo="hero"]',
  },
];

const TOTAL_BUDGET_SEC = 5 * 60;

const PHASE_TONE: Record<Phase, string> = {
  Problem: 'bg-red-100 text-red-800 border-red-200',
  Solution: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Why it matters': 'bg-amber-100 text-amber-800 border-amber-200',
  Tech: 'bg-sky-100 text-sky-800 border-sky-200',
  Future: 'bg-violet-100 text-violet-800 border-violet-200',
  Close: 'bg-primary/10 text-primary border-primary/20',
};

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function DemoGuide() {
  const navigate = useNavigate();
  const location = useLocation();
  const [running, setRunning] = useState(false);
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  const step = STEPS[idx];

  const start = useCallback(() => {
    setIdx(0);
    setElapsed(0);
    startedAt.current = Date.now();
    setRunning(true);
    void navigate('/');
  }, [navigate]);

  const stop = useCallback(() => {
    setRunning(false);
    startedAt.current = null;
  }, []);

  const next = useCallback(() => setIdx((i) => Math.min(i + 1, STEPS.length - 1)), []);
  const prev = useCallback(() => setIdx((i) => Math.max(i - 1, 0)), []);

  // ── running clock ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      if (startedAt.current) setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  // ── navigate to the step's screen ───────────────────────────────────────
  useEffect(() => {
    if (!running) return;
    if (location.pathname !== step.route) void navigate(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, idx]);

  // ── spotlight the step's target element (best-effort) ───────────────────
  useEffect(() => {
    if (!running || !step.selector) return;
    let el: HTMLElement | null = null;
    const apply = () => {
      el = document.querySelector<HTMLElement>(step.selector!);
      if (el) {
        el.classList.add('gift-demo-spotlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    const t = setTimeout(apply, 350); // let the route render first
    return () => {
      clearTimeout(t);
      el?.classList.remove('gift-demo-spotlight');
      document
        .querySelectorAll('.gift-demo-spotlight')
        .forEach((n) => n.classList.remove('gift-demo-spotlight'));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, idx, location.pathname]);

  // ── keyboard: launch chord (g then d), and in-demo controls ─────────────
  useEffect(() => {
    let gPending = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (running) {
        if (e.key === 'ArrowRight' || e.key === ' ') {
          e.preventDefault();
          if (idx === STEPS.length - 1) stop();
          else next();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          prev();
        } else if (e.key === 'Escape') {
          stop();
        }
        return;
      }
      if (typing) return;
      if (e.key === 'g') {
        gPending = true;
        if (gTimer) clearTimeout(gTimer);
        gTimer = setTimeout(() => (gPending = false), 800);
      } else if (e.key === 'd' && gPending) {
        gPending = false;
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (gTimer) clearTimeout(gTimer);
    };
  }, [running, idx, next, prev, start, stop]);

  // ── header button hook ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => start();
    window.addEventListener('gift-demo:start', handler);
    return () => window.removeEventListener('gift-demo:start', handler);
  }, [start]);

  // ── idle launcher pill ──────────────────────────────────────────────────
  if (!running) {
    return (
      <button
        type="button"
        onClick={start}
        aria-label="Start the 5-minute demo walkthrough"
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-2.5 text-sm font-semibold text-amber-900 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
      >
        <Sparkles className="h-4 w-4 text-amber-600" />
        Demo walkthrough
        <span className="hidden rounded bg-amber-200/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 sm:inline">
          g d
        </span>
      </button>
    );
  }

  const isLast = idx === STEPS.length - 1;
  const overBudget = elapsed > TOTAL_BUDGET_SEC;
  const progressPct = Math.min(100, (elapsed / TOTAL_BUDGET_SEC) * 100);

  return (
    <>
      {/* dim backdrop so the spotlight reads, but the app stays clickable around the panel */}
      <div className="pointer-events-none fixed inset-0 z-30 bg-slate-950/10" aria-hidden />

      <aside
        className="gift-fade-in fixed bottom-5 left-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border bg-card shadow-2xl"
        role="dialog"
        aria-label="Demo walkthrough"
      >
        {/* total-time progress bar */}
        <div className="h-1 w-full bg-muted">
          <div
            className={`h-full transition-all duration-500 ${overBudget ? 'bg-red-500' : 'bg-emerald-500'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="flex items-start gap-3 p-4">
          <GiftSeal size={40} showText={false} className="mt-0.5 hidden shrink-0 sm:block" />

          <div className="min-w-0 flex-1">
            {/* meta row */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PHASE_TONE[step.phase]}`}>
                {step.phase}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground">
                Step {idx + 1} / {STEPS.length}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" /> {step.clock}
              </span>
              <span
                className={`ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                  overBudget ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {fmt(elapsed)} <span className="font-normal opacity-60">/ 5:00</span>
              </span>
            </div>

            <h3 className="mt-2 text-base font-bold leading-snug text-foreground">{step.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-foreground/85">{step.say}</p>

            {step.do && step.do.length > 0 && (
              <ul className="mt-2.5 space-y-1">
                {step.do.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                    <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* controls */}
            <div className="mt-3.5 flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={prev} disabled={idx === 0}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              {isLast ? (
                <Button size="sm" onClick={stop}>
                  <CheckCircle2 className="h-4 w-4" /> Finish
                </Button>
              ) : (
                <Button size="sm" onClick={next}>
                  Next <ArrowRight className="h-4 w-4" />
                </Button>
              )}

              {/* step dots */}
              <div className="ml-1 hidden flex-wrap items-center gap-1 sm:flex">
                {STEPS.map((s, i) => (
                  <button
                    key={s.clock}
                    type="button"
                    aria-label={`Go to step ${i + 1}: ${s.title}`}
                    onClick={() => setIdx(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === idx ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60'
                    }`}
                  />
                ))}
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={stop}
                className="ml-auto text-muted-foreground"
                aria-label="Exit demo"
              >
                <X className="h-4 w-4" /> Exit
              </Button>
            </div>

            <p className="mt-2 text-[10px] text-muted-foreground/70">
              <kbd className="rounded border bg-muted px-1">→</kbd>/<kbd className="rounded border bg-muted px-1">Space</kbd> next ·{' '}
              <kbd className="rounded border bg-muted px-1">←</kbd> back ·{' '}
              <kbd className="rounded border bg-muted px-1">Esc</kbd> exit
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

/** Small header trigger — dispatches the launch event so the guide stays self-contained. */
export function DemoLaunchButton({ className = '' }: { className?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.dispatchEvent(new Event('gift-demo:start'))}
      className={`gap-1.5 border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 text-amber-900 hover:from-amber-100 hover:to-yellow-100 ${className}`}
    >
      <Play className="h-3.5 w-3.5 text-amber-600" />
      <span className="hidden sm:inline">Demo</span>
      <Sparkles className="h-3.5 w-3.5 text-amber-600" />
    </Button>
  );
}
