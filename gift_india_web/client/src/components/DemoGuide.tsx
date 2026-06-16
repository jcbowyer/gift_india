import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button } from '@databricks/appkit-ui/react';
import {
  Sparkles,
  X,
  ArrowRight,
  ArrowLeft,
  Play,
  CheckCircle2,
  Clock,
  ScrollText,
  ChevronRight,
} from 'lucide-react';
import { GiftSeal } from './GiftSeal';
import { cn } from '../lib/utils';

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

type Phase = 'Title' | 'Open' | 'Problem' | 'Solution' | 'Why it matters' | 'Tech' | 'Future' | 'Close';

interface PunchlineReveal {
  /** Setup — shown immediately. */
  before: string;
  /** The line that lands after the beat (e.g. “It’s grit.”). */
  line: string;
  /** Epilogue — fades in after the punchline. */
  after: string;
  /** Silence before the punchline (default 2.8s). */
  beatMs?: number;
  /** Copy shown during the beat — frames the pause intentionally. */
  beatHint?: string;
  beatSubhint?: string;
}

interface Step {
  phase: Phase;
  clock: string; // budgeted window, shown to the presenter
  title: string;
  /** Optional subtitle shown under the title (title slide). */
  subtitle?: string;
  /** Render subtitle at presentation scale (tech / hero beats). */
  subtitleLarge?: boolean;
  /** Prominent lead line before the main talk track. */
  sayLead?: string;
  route: string;
  /** Talk track — what the presenter says. */
  say?: string;
  /** Staged punchline reveal (overrides `say` when set). */
  punchline?: PunchlineReveal;
  /** Presenter-only cues — kept for DEMO.md; not shown in the in-app guide. */
  do?: string[];
  /** Optional CSS selector to spotlight on this step (no-ops if absent). */
  selector?: string;
  /** Full-screen live app — teleprompter collapsed by default; reopen via “Script”. */
  appFocus?: boolean;
  /** Primary button label when leaving the talk track for live UI (e.g. “Go to map”). */
  appGoLabel?: string;
  /** Open on talk track before live UI; defaults true when `route` is not `/`. */
  scriptFirst?: boolean;
  /** Tech-stack decision matrix (Decision Area / approach / why). */
  decisionTable?: DecisionTableRow[];
}

interface DecisionTableRow {
  area: string;
  approach: string;
  why: string;
}

const TECH_DECISION_TABLE: DecisionTableRow[] = [
  {
    area: 'AI_Classify vs. AI_Query',
    approach: 'We treat AI as an extractor (structured data), not a conversationalist.',
    why: 'Avoids hallucinated "answers" and conversational fluff; forces database-ready outputs.',
  },
  {
    area: 'Batching & Model Selection',
    approach: 'Cost-optimized routing: simple tasks to small models, complex to "heavy" models.',
    why: 'Prevents model bloat and stops overspending on low-complexity routine tasks.',
  },
  {
    area: 'Data Augmentation',
    approach: 'We use Splink for probabilistic record linkage before AI processing.',
    why: 'AI doesn\'t "guess" identities; we rely on proven statistical models to ensure data quality first.',
  },
  {
    area: 'Native Platform Leverage',
    approach: 'We use Dabs, Genie, AI_Query, and Lakehouse FTS for everything possible.',
    why: 'We minimize "franken-coding" by relying on platform-native infrastructure rather than custom scripts.',
  },
];

const STEPS: Step[] = [
  {
    phase: 'Title',
    clock: '0:00 – 0:20',
    title: 'Beyond the Hospital Directory',
    subtitle: 'Grounding Improved Patient Care',
    route: '/',
    say: '**John Bowyer** · **Mason Bushyeager** · **Billy Houston**\n\nDatabricks for Good hackathon in support of the Virtue Foundation — **GIFT Gauge** (Track 1)',
    do: ['Hold the title. Let the room read the authors and subtitle before you advance.'],
  },
  {
    phase: 'Open',
    clock: '0:20 – 0:45',
    title: 'The secret',
    route: '/',
    punchline: {
      before:
        'If you like this demo, here’s the secret — it’s not about technology or intelligence. After 30 years, we’ve found the number one predictor of success comes down to a single thing.',
      line: 'It’s grit.',
      after:
        'Yesterday our project was struggling. Every instinct said go to dinner, go to bed, call it quits. We didn’t quit. And today, this is what you see.',
      beatMs: 3200,
      beatHint: 'In the real world, the answer never lands on cue.',
      beatSubhint: 'building suspense… · tap to reveal',
    },
    do: ['Hold the beat — let the room sit with it, then “It’s grit.” lands.', 'Gesture at the app on the last line.'],
  },
  {
    phase: 'Open',
    clock: '0:45 – 1:05',
    title: 'Priya\'s User Story',
    route: '/',
    say: 'We’re at the Databricks for Good hackathon in support of the Virtue Foundation — and we’re building for **Priya**. She runs allocation for a nonprofit health network across India. Her job isn’t to browse hospital websites; it’s to **place patients and steer referrals** toward facilities that are clinically capable, cost-effective, and defensible when a district officer or donor asks *why*.\n\nEvery morning, the same trap: her spreadsheet says 847 facilities in Uttar Pradesh claim an **ICU**. A patient needs one tonight. Half those rows are duplicate entities, stale locations, or self-reported website copy nobody has verified. She’s been burned by **hospital directories** before — staring at a list, unable to tell if a hospital is actually equipped for the procedure or just **gaming the search results**.\n\nRouting wrong isn’t a data-quality bug. **It’s a patient-safety failure.**',
    do: ['Name Priya if you can — make the persona real.', 'Land the ICU / Uttar Pradesh numbers; pause before “patient-safety failure.”'],
  },
  {
    phase: 'Problem',
    clock: '1:05 – 1:25',
    title: 'The burning question',
    route: '/',
    say: 'We’re here to answer one burning question that usually takes weeks of phone calls to resolve: **Can this hospital actually do what it claims?** **GIFT Gauge** — Governance, Integrity and Facility Trust — scores each facility by the evidence behind its claims, with citations you can open, challenge, and override.',
    selector: '[data-demo="hero"]',
    appFocus: true,
    scriptFirst: false,
  },
  {
    phase: 'Solution',
    clock: '1:25 – 1:45',
    title: 'Capability + region',
    route: '/',
    say: 'A planner starts the way they think: I need intensive care, in this region. No database queries, no spelunking through scraped hospital websites.',
    do: ['Click the ICU capability tile.', 'Pick a state in the region filter below.'],
    selector: '[data-demo="capabilities"]',
    appFocus: true,
    scriptFirst: false,
  },
  {
    phase: 'Solution',
    clock: '1:45 – 2:05',
    title: 'Ranked by evidence',
    route: '/',
    say: 'Instantly — every hospital claiming intensive care here, ranked by how strongly the claim is backed. Green strong, amber partial, red suspicious. The dial is a trust score computed in our gold tables, not a vibe.',
    do: ['Point at the trust dials and the colored signal badges.'],
    selector: '[data-demo="results"]',
    appFocus: true,
    scriptFirst: false,
  },
  {
    phase: 'Solution',
    clock: '2:05 – 2:25',
    title: 'Deep dive on citations',
    route: '/',
    say: 'Open any facility and you see the receipts — the actual citations: JCI accreditation, state registry, PMJAY, the facility’s own site. Each quotes a real source field with a reliability weight. Supporting in green, contradicting in red. Nothing fabricated.',
    do: ['Expand the top (strong) result.', 'Read one supporting citation aloud.', 'Switch the filter to Suspicious; expand a red one to show contradicting evidence.'],
    selector: '[data-demo="results"]',
    appFocus: true,
    scriptFirst: false,
  },
  {
    phase: 'Solution',
    clock: '2:25 – 2:45',
    title: 'Human-in-the-loop override',
    route: '/',
    say: 'The machine isn’t the final word. A planner with ground truth — a phone call, an inspection — overrides the assessment and leaves a note. It saves to Lakebase and layers on top of the computed signal.',
    do: ['Expand a facility first if needed.', 'Click “Override assessment”.', 'Pick a trust signal; add a note; save to My Reviews.'],
    selector: '[data-demo="override"]',
    appFocus: true,
    scriptFirst: false,
  },
  {
    phase: 'Solution',
    clock: '2:45 – 2:55',
    title: 'An auditable trail',
    route: '/reviews',
    say: 'Every override is logged here — an auditable trail of human judgment over the evidence. Governance you can actually defend.',
    do: ['Point at the override log: original → override, with the reviewer note.'],
    selector: '[data-demo="reviews"]',
    appFocus: true,
    scriptFirst: false,
    appGoLabel: 'Back to app',
  },
  {
    phase: 'Why it matters',
    clock: '2:55 – 3:15',
    title: 'Where trust lives — and where it’s missing',
    route: '/navigator',
    say: 'Four things make this trustworthy: JCI as the global gold standard, an India focus on purpose, human overrides on the record, and governed data on Lakebase. On the map, zoom nation → state → district to see where trustworthy capacity exists — and where the deserts are.',
    do: ['Drill from a state into its districts.', 'Note the strong/partial/suspicious breakdown bar.'],
    selector: '[data-demo="navigator-map"]',
    appFocus: true,
    scriptFirst: false,
    appGoLabel: 'Back to app',
  },
  {
    phase: 'Why it matters',
    clock: '3:15 – 3:30',
    title: 'Benchmark into a decision',
    route: '/scorecard',
    say: 'Benchmark any district against its region and the nation — that’s how trust becomes an allocation decision, not just a dashboard.',
    do: ['Pick a district; compare its metrics against region and nation.'],
    selector: '[data-demo="scorecard"]',
    appFocus: true,
    scriptFirst: false,
    appGoLabel: 'Back to app',
  },
  {
    phase: 'Tech',
    clock: '3:30 – 3:48',
    title: 'Built on Lakehouse',
    subtitle: 'Human-in-the-loop · why we defy the AI-default',
    subtitleLarge: true,
    route: '/',
    sayLead:
      'Everyone defaults to chatbots. We treat AI as an extractor, Splink before identity guesswork, and platform-native tooling before franken-code.',
    say: 'We’re not building on duct tape and prayers — the Databricks Lakehouse is our foundation. **MDM & Lakebase** deduplicates the chaos. **Grounded verification** crawls live sites and cross-references CMS and accreditation boards. **Databricks Apps & Genie** deploy a secure clinical navigator that’s read the compliance library. **AgentBricks** classify intent before we query; a **supervisor agent** forces the paper trail.',
    do: ['Land the subtitle and lead line, then keep the Lakehouse stack tight.'],
  },
  {
    phase: 'Tech',
    clock: '3:48 – 4:10',
    title: 'Tech stack: Decisions we made for ourselves',
    route: '/',
    decisionTable: TECH_DECISION_TABLE,
    do: ['Scan the table — land on AI_Classify vs. AI_Query and Splink before AI processing.'],
  },
  {
    phase: 'Open',
    clock: '4:10 – 4:22',
    title: 'The “30 years” problem: Call to Action',
    route: '/',
    say: 'There’s a massive difference between 30 years of experience and one year repeated 30 times. Databricks isn’t just storage — it’s how we turn learning into an ontology of decisions. We capture the why behind the what, keep humans in the loop, and scale expertise planners can actually defend.',
  },
  {
    phase: 'Future',
    clock: '4:22 – 4:30',
    title: 'The foundation for the other tracks',
    route: '/',
    say: 'GIFT Gauge is Track 1 — can this facility do what it claims? The same trust layer feeds the rest: Medical Desert Planner (the map already shows the gaps), Referral Copilot (route to capability you trust), Data Readiness (contradicting-evidence flags are a quality signal). Trust is the foundation the other three stand on.',
    do: ['Tie in lightly — don’t over-promise.'],
  },
  {
    phase: 'Close',
    clock: '4:30 – 5:00',
    title: 'Closing the loop',
    route: '/',
    say: 'Huge thanks to Databricks and the Virtue Foundation. We aren’t just talking about the future of care — we’re building the plumbing so planners stop guessing and start steering. The best way to change the world isn’t to look for a magic solution — **it’s to try.** **GIFT Gauge** — Governance, Integrity and Facility Trust.',
    do: ['Pause. Ask: Lakebase foundation or AgentBricks decision-making — where would your team feel relief first?'],
    selector: '[data-demo="hero"]',
  },
];

const TOTAL_BUDGET_SEC = 5 * 60;

/** Parse demo clock windows like `0:45 – 1:05` into seconds on the 5:00 timeline. */
function parseClockRange(clock: string): { startSec: number; endSec: number } {
  const [startRaw, endRaw] = clock.split(/\s*[–—-]\s*/);
  const toSec = (t: string) => {
    const [m, s] = t.trim().split(':').map(Number);
    return m * 60 + s;
  };
  return { startSec: toSec(startRaw), endSec: toSec(endRaw) };
}

const STEP_TIMINGS = STEPS.map((s) => parseClockRange(s.clock));

const PHASE_TONE: Record<Phase, string> = {
  Title: 'bg-slate-100 text-slate-800 border-slate-200',
  Open: 'bg-orange-100 text-orange-800 border-orange-200',
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

function appGoLabelFor(step: Step): string {
  if (step.appGoLabel) return step.appGoLabel;
  return 'Back to app';
}

function scriptFirstFor(step: Step): boolean {
  if (step.scriptFirst != null) return step.scriptFirst;
  if (step.appFocus) return false;
  return step.route !== '/';
}

/** Scroll a spotlight target into view — docked under teleprompter or centered for full-screen app focus. */
/** Remove demo spotlight / body classes so the app is never left dimmed after exit. */
function teardownDemo() {
  document.body.classList.remove('gift-demo-spotlight-active', 'gift-demo-app-focus-active');
  document.querySelectorAll('.gift-demo-spotlight').forEach((node) => {
    node.classList.remove('gift-demo-spotlight');
  });
}

function scrollDemoTargetIntoView(el: HTMLElement, mode: 'docked' | 'fullscreen' = 'docked') {
  const rect = el.getBoundingClientRect();
  const elCenterY = rect.top + rect.height / 2;
  let targetCenterY: number;
  if (mode === 'fullscreen') {
    targetCenterY = window.innerHeight * 0.46;
  } else {
    const reserveTop = Math.min(window.innerHeight * 0.44, 360) + 12;
    const available = window.innerHeight - reserveTop;
    targetCenterY = reserveTop + available * 0.58;
  }
  const scrollDelta = elCenterY - targetCenterY;
  if (Math.abs(scrollDelta) > 6) {
    window.scrollBy({ top: scrollDelta, behavior: 'smooth' });
  }
}

type PunchlineStage = 'beat' | 'line' | 'complete';

export type PunchlineSayHandle = {
  /** Advance the staged reveal; returns true if navigation should wait. */
  tryAdvance: () => boolean;
};

const PunchlineSay = forwardRef<
  PunchlineSayHandle,
  PunchlineReveal & { onStageChange?: (stage: PunchlineStage) => void }
>(function PunchlineSay(
  {
    before,
    line,
    after,
    beatMs = 2800,
    beatHint = 'In the real world, the answer takes a beat.',
    beatSubhint = 'building suspense… · tap to reveal',
    onStageChange,
  },
  ref,
) {
  const [stage, setStage] = useState<PunchlineStage>('beat');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  }, []);

  const goToLine = useCallback(() => {
    setStage('line');
    schedule(() => setStage('complete'), 1100);
  }, [schedule]);

  const revealNow = useCallback(() => {
    clearTimers();
    goToLine();
  }, [clearTimers, goToLine]);

  const reset = useCallback(() => {
    clearTimers();
    setStage('beat');
    schedule(goToLine, beatMs);
  }, [beatMs, clearTimers, goToLine, schedule]);

  useEffect(() => {
    reset();
    return clearTimers;
  }, [before, line, after, beatMs, reset, clearTimers]);

  useEffect(() => {
    onStageChange?.(stage);
  }, [stage, onStageChange]);

  useImperativeHandle(
    ref,
    () => ({
      tryAdvance: () => {
        if (stage === 'beat') {
          clearTimers();
          goToLine();
          return true;
        }
        if (stage === 'line') {
          clearTimers();
          setStage('complete');
          return true;
        }
        return false;
      },
    }),
    [stage, clearTimers, goToLine],
  );

  const [lead, grit] = line.includes('grit') ? line.split(/(grit\.?)/i) : [line, ''];

  return (
    <div className="mx-auto mt-2 max-w-3xl sm:mt-3">
      <p className="text-base leading-snug text-foreground/90 sm:text-lg sm:leading-relaxed">{before}</p>

      {stage === 'beat' && (
        <button
          type="button"
          onClick={revealNow}
          className="gift-demo-beat mx-auto mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-amber-200/80 bg-gradient-to-b from-amber-50/90 to-yellow-50/60 px-5 py-3 shadow-sm transition hover:border-amber-300 hover:shadow-md"
          aria-label="Reveal punchline now"
        >
          <span className="flex items-center gap-2" aria-hidden>
            <Sparkles className="gift-demo-beat-sparkle h-4 w-4 text-amber-500" />
            <span className="flex gap-1.5">
              <span className="gift-demo-beat-dot" />
              <span className="gift-demo-beat-dot" style={{ animationDelay: '0.2s' }} />
              <span className="gift-demo-beat-dot" style={{ animationDelay: '0.4s' }} />
            </span>
            <Sparkles className="gift-demo-beat-sparkle h-4 w-4 text-amber-500" style={{ animationDelay: '0.3s' }} />
          </span>
          <span className="max-w-xs text-sm font-medium leading-snug text-amber-900/90 sm:max-w-sm sm:text-base">
            {beatHint}
          </span>
          <span className="text-[10px] tracking-wide text-amber-700/55 uppercase sm:text-xs">{beatSubhint}</span>
        </button>
      )}

      {(stage === 'line' || stage === 'complete') && (
        <div
          className={`gift-demo-grit-stage relative my-4 flex justify-center sm:my-6 ${
            stage === 'line' ? '' : 'gift-demo-grit-settled'
          }`}
        >
          <div className="gift-demo-grit-sparkles pointer-events-none absolute inset-0" aria-hidden>
            <Sparkles className="gift-demo-grit-sparkle gift-demo-grit-sparkle-a" />
            <Sparkles className="gift-demo-grit-sparkle gift-demo-grit-sparkle-b" />
            <Sparkles className="gift-demo-grit-sparkle gift-demo-grit-sparkle-c" />
            <Sparkles className="gift-demo-grit-sparkle gift-demo-grit-sparkle-d" />
            <span className="gift-demo-grit-particle gift-demo-grit-particle-1" />
            <span className="gift-demo-grit-particle gift-demo-grit-particle-2" />
            <span className="gift-demo-grit-particle gift-demo-grit-particle-3" />
            <span className="gift-demo-grit-particle gift-demo-grit-particle-4" />
            <span className="gift-demo-grit-particle gift-demo-grit-particle-5" />
            <span className="gift-demo-grit-particle gift-demo-grit-particle-6" />
          </div>
          <p
            className="gift-demo-grit-reveal relative z-10 text-center text-5xl font-black leading-none tracking-tight sm:text-6xl md:text-7xl lg:text-8xl"
            aria-live="assertive"
          >
            {grit ? (
              <>
                <span className="text-foreground/90">{lead}</span>
                <span className="gift-demo-grit-word">{grit}</span>
              </>
            ) : (
              line
            )}
          </p>
        </div>
      )}

      {stage === 'complete' && (
        <p className="gift-demo-after-reveal text-base leading-snug text-foreground/90 sm:text-lg sm:leading-relaxed">
          {after}
        </p>
      )}
    </div>
  );
});

function renderSayText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-bold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

function DemoSay({ text }: { text: string }) {
  const paragraphs = text.split('\n\n');
  return (
    <div className="mx-auto mt-2 max-w-3xl space-y-3 sm:mt-3">
      {paragraphs.map((para, i) => (
        <p key={i} className="text-base leading-snug text-foreground/90 sm:text-lg sm:leading-relaxed">
          {renderSayText(para)}
        </p>
      ))}
    </div>
  );
}

/** Grouped tech-beat hook — subtitle + lead line without oversized type. */
function DemoTechIntro({ subtitle, sayLead }: { subtitle: string; sayLead: string }) {
  return (
    <div className="mx-auto mt-3 max-w-3xl rounded-xl border border-sky-200/80 bg-gradient-to-b from-sky-50/90 to-slate-50/50 px-4 py-3.5 text-left sm:mt-4 sm:px-5 sm:py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-800/80 sm:text-sm">
        {subtitle}
      </p>
      <p className="mt-2.5 text-base font-semibold leading-snug text-foreground sm:text-lg sm:leading-relaxed">
        {renderSayText(sayLead)}
      </p>
    </div>
  );
}

function DemoDecisionTable({ rows }: { rows: DecisionTableRow[] }) {
  return (
    <div className="mx-auto mt-4 max-w-6xl overflow-x-auto rounded-xl border border-border/70 bg-background/50 text-left shadow-sm sm:mt-5">
      <table className="w-full min-w-[800px] border-collapse text-sm sm:text-base">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-3 py-3 text-left font-bold text-foreground sm:px-4 sm:py-3.5 sm:text-lg">
              Decision Area
            </th>
            <th className="px-3 py-3 text-left font-bold text-foreground sm:px-4 sm:py-3.5 sm:text-lg">
              Our Human-in-the-Loop Approach
            </th>
            <th className="px-3 py-3 text-left font-bold text-foreground sm:px-4 sm:py-3.5 sm:text-lg">
              Why It Defies the AI-Default
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.area} className={cn('align-top', i < rows.length - 1 && 'border-b border-border/60')}>
              <td className="px-3 py-3 font-semibold leading-snug text-foreground sm:px-4 sm:py-3.5 sm:text-base">
                {row.area}
              </td>
              <td className="px-3 py-3 leading-snug text-foreground/90 sm:px-4 sm:py-3.5 sm:leading-relaxed">
                {row.approach}
              </td>
              <td className="px-3 py-3 leading-snug text-foreground/75 sm:px-4 sm:py-3.5 sm:leading-relaxed">
                {row.why}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DemoAdvanceCue({ className }: { className?: string }) {
  return (
    <span
      className={cn('gift-demo-advance-cue inline-flex items-center text-primary/70', className)}
      aria-hidden
    >
      <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2.25} />
    </span>
  );
}

function DemoNextButton({
  showCue,
  onClick,
  iconOnly = false,
  size = 'sm',
}: {
  showCue: boolean;
  onClick: () => void;
  iconOnly?: boolean;
  size?: 'sm' | 'default';
}) {
  return (
    <div className={cn('relative inline-flex items-center', showCue && 'gift-demo-next-wrap pr-1')}>
      <Button
        size={size}
        onClick={onClick}
        className={cn(showCue && 'gift-demo-next-ready')}
        aria-label={showCue ? 'Next step — on schedule' : 'Next step'}
      >
        {!iconOnly && (
          <>
            Next <ArrowRight className="h-4 w-4" />
          </>
        )}
        {iconOnly ? <ArrowRight className="h-4 w-4" /> : null}
      </Button>
      {showCue ? (
        <DemoAdvanceCue className="gift-demo-advance-cue-next absolute -right-4 top-1/2 -translate-y-1/2 sm:-right-5" />
      ) : null}
    </div>
  );
}

export function DemoGuide() {
  const navigate = useNavigate();
  const location = useLocation();
  const [running, setRunning] = useState(false);
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [scriptOpen, setScriptOpen] = useState(true);
  const [punchlineStage, setPunchlineStage] = useState<PunchlineStage>('beat');
  const startedAt = useRef<number | null>(null);
  const punchlineRef = useRef<PunchlineSayHandle>(null);

  const step = STEPS[idx];
  const hasSpotlight = Boolean(step.selector) && !step.punchline;
  const isAppFocus = hasSpotlight && Boolean(step.appFocus);
  const isImmersive = !hasSpotlight;
  const showFullscreenApp = isAppFocus && !scriptOpen;
  const showScriptOverApp = isAppFocus && scriptOpen;
  const showScriptImmersive = showScriptOverApp && scriptFirstFor(step);
  const showScriptSheet = showScriptOverApp && !scriptFirstFor(step);
  const showPresenter = isImmersive || showScriptOverApp;
  const goLabel = appGoLabelFor(step);

  const goToApp = useCallback(() => {
    if (location.pathname !== step.route) void navigate(step.route);
    setScriptOpen(false);
  }, [location.pathname, navigate, step.route]);

  const start = useCallback(() => {
    setIdx(0);
    setElapsed(0);
    setScriptOpen(true);
    setPunchlineStage('beat');
    startedAt.current = Date.now();
    setRunning(true);
    void navigate('/');
  }, [navigate]);

  const stop = useCallback(() => {
    setRunning(false);
    setScriptOpen(true);
    setPunchlineStage('beat');
    startedAt.current = null;
    teardownDemo();
    window.dispatchEvent(new Event('gift-demo:stop'));
  }, []);

  const next = useCallback(() => setIdx((i) => Math.min(i + 1, STEPS.length - 1)), []);
  const prev = useCallback(() => setIdx((i) => Math.max(i - 1, 0)), []);

  const advanceStep = useCallback(() => {
    if (punchlineRef.current?.tryAdvance()) return;
    if (idx === STEPS.length - 1) stop();
    else next();
  }, [idx, next, stop]);

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

  // ── app-focus: live UI first; script via “Back to script” bottom sheet ───
  useEffect(() => {
    if (!running) return;
    if (!isAppFocus) {
      setScriptOpen(true);
      return;
    }
    setScriptOpen(scriptFirstFor(step));
  }, [running, idx, isAppFocus, step]);

  // ── always tear down DOM hooks when the walkthrough ends or unmounts ────
  useEffect(() => {
    if (!running) teardownDemo();
    return () => teardownDemo();
  }, [running]);

  // ── spotlight the step's target element (best-effort) ───────────────────
  useEffect(() => {
    if (!running || !step.selector || step.punchline) {
      return;
    }
    document.body.classList.add('gift-demo-spotlight-active');
    if (showFullscreenApp) document.body.classList.add('gift-demo-app-focus-active');
    else document.body.classList.remove('gift-demo-app-focus-active');

    const scrollMode = showFullscreenApp ? 'fullscreen' : 'docked';
    let el: HTMLElement | null = null;
    const apply = () => {
      el = document.querySelector<HTMLElement>(step.selector!);
      if (el) {
        el.classList.add('gift-demo-spotlight');
        scrollDemoTargetIntoView(el, scrollMode);
      }
    };
    const t = setTimeout(apply, 350);
    const t2 = setTimeout(apply, 750);
    const onResize = () => {
      if (el) scrollDemoTargetIntoView(el, scrollMode);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      window.removeEventListener('resize', onResize);
      teardownDemo();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, idx, location.pathname, showFullscreenApp]);

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
          advanceStep();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          prev();
        } else if (e.key === 'Escape') {
          stop();
        } else if (e.key === 's' && !typing && STEPS[idx]?.appFocus) {
          e.preventDefault();
          if (scriptOpen) goToApp();
          else setScriptOpen(true);
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
  }, [running, idx, advanceStep, prev, start, stop, goToApp, scriptOpen]);

  // ── header button hook ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => start();
    window.addEventListener('gift-demo:start', handler);
    return () => window.removeEventListener('gift-demo:start', handler);
  }, [start]);

  const isLast = idx === STEPS.length - 1;
  const overBudget = elapsed > TOTAL_BUDGET_SEC;
  const progressPct = Math.min(100, (elapsed / TOTAL_BUDGET_SEC) * 100);
  const stepEndSec = STEP_TIMINGS[idx]?.endSec ?? TOTAL_BUDGET_SEC;
  const punchlineReady = !step.punchline || punchlineStage === 'complete';
  const showAdvanceCue = !isLast && elapsed >= stepEndSec && punchlineReady;
  const presenterDocked = hasSpotlight && !isAppFocus;
  const isTechHeroBeat = Boolean(step.subtitleLarge && step.sayLead);
  const isDecisionTableBeat = Boolean(step.decisionTable);

  const presenterControls = (
    <>
      <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        <Button variant="ghost" size="sm" onClick={prev} disabled={idx === 0}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {isLast ? (
          <Button size="sm" onClick={stop}>
            <CheckCircle2 className="h-4 w-4" /> Finish
          </Button>
        ) : (
          <DemoNextButton showCue={showAdvanceCue} onClick={advanceStep} />
        )}

        <div className="flex flex-wrap items-center justify-center gap-1 px-1">
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

        <Button variant="ghost" size="sm" onClick={stop} className="text-muted-foreground" aria-label="Exit demo">
          <X className="h-4 w-4" /> Exit
        </Button>
      </div>

      <p className="mt-2 hidden text-[10px] text-muted-foreground/70 sm:block sm:text-xs">
        <kbd className="rounded border bg-muted px-1 py-0.5">→</kbd>/<kbd className="rounded border bg-muted px-1 py-0.5">Space</kbd> next ·{' '}
        <kbd className="rounded border bg-muted px-1 py-0.5">←</kbd> back ·{' '}
        <kbd className="rounded border bg-muted px-1 py-0.5">Esc</kbd> exit
      </p>
    </>
  );

  return (
    <>
      {!running ? (
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
      ) : (
        <>
      <div
        className={cn(
          'pointer-events-none fixed inset-0 z-30',
          showFullscreenApp && 'gift-demo-backdrop-app-focus',
          showScriptImmersive && 'gift-demo-backdrop-immersive',
          showScriptSheet && 'gift-demo-backdrop-script-over-app',
          !showFullscreenApp && !showScriptOverApp && presenterDocked && 'gift-demo-backdrop-spotlight',
          isImmersive && 'gift-demo-backdrop-immersive',
        )}
        aria-hidden
      />

      {showFullscreenApp && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4">
          <Button
            size="default"
            className="gift-demo-back-to-script pointer-events-auto gap-2 shadow-lg"
            onClick={() => setScriptOpen(true)}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to script
          </Button>
        </div>
      )}

      {showFullscreenApp && (
        <div className="gift-demo-chrome pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-4 sm:pb-4">
          <div className="gift-demo-chrome-bar pointer-events-auto mx-auto max-w-4xl rounded-2xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur-md">
            <div className="h-1 w-full shrink-0 overflow-hidden rounded-t-2xl bg-muted/80">
              <div
                className={`h-full transition-all duration-500 ${overBudget ? 'bg-red-500' : 'bg-emerald-500'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{step.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  Step {idx + 1} / {STEPS.length} · {fmt(elapsed)} / 5:00
                </p>
              </div>
              <Button
                size="sm"
                className="gift-demo-back-to-script gap-1.5 shrink-0 font-semibold"
                onClick={() => setScriptOpen(true)}
              >
                <ScrollText className="h-4 w-4" /> Back to script
              </Button>
              <Button variant="ghost" size="sm" onClick={prev} disabled={idx === 0} aria-label="Previous step">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              {isLast ? (
                <Button size="sm" onClick={stop}>
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
              ) : (
                <DemoNextButton showCue={showAdvanceCue} onClick={advanceStep} iconOnly />
              )}
              <Button variant="ghost" size="sm" onClick={stop} className="text-muted-foreground" aria-label="Exit demo">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {showPresenter && (
        <div
          className={cn(
            'pointer-events-none fixed inset-0 z-50 flex p-3 sm:p-5',
            (isImmersive || showScriptImmersive) && 'items-center justify-center',
            presenterDocked && 'items-start justify-center pt-14 sm:pt-16',
            showScriptSheet && 'items-end justify-center p-0 sm:p-0',
          )}
        >
          <aside
            className={cn(
              'gift-demo-presenter gift-fade-in pointer-events-auto flex flex-col overflow-hidden rounded-2xl shadow-2xl sm:rounded-3xl',
              isDecisionTableBeat && (isImmersive || showScriptImmersive)
                ? 'w-[min(64rem,calc(100vw-1.5rem))]'
                : 'w-[min(52rem,calc(100vw-1.5rem))]',
              (isImmersive || showScriptImmersive) &&
                'gift-demo-presenter-immersive border border-border/60 bg-card max-h-[calc(100dvh-1.5rem)]',
              showScriptSheet && 'border border-white/60 bg-card/95 backdrop-blur-md',
              presenterDocked && 'gift-demo-presenter-spotlight max-h-[min(42vh,22rem)] border border-white/60 bg-card/95 backdrop-blur-md',
              showScriptSheet && 'gift-demo-presenter-sheet max-h-[min(52vh,28rem)] w-full max-w-none rounded-b-none rounded-t-2xl sm:rounded-t-3xl',
              (step.punchline || step.phase === 'Title') && 'gift-demo-presenter-open',
            )}
            role="dialog"
            aria-label="Demo walkthrough"
          >
            <div className="h-1 w-full shrink-0 bg-muted/80">
              <div
                className={`h-full transition-all duration-500 ${overBudget ? 'bg-red-500' : 'bg-emerald-500'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {showScriptSheet && (
              <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PHASE_TONE[step.phase]}`}>
                  {step.phase}
                </span>
                <Button variant="outline" size="sm" className="gift-demo-go-app gap-1.5 border-0" onClick={goToApp}>
                  <ArrowLeft className="h-4 w-4" /> {goLabel}
                </Button>
              </div>
            )}

            <div
              className={cn(
                'min-h-0 flex-1 overflow-y-auto px-4 text-center sm:px-6',
                presenterDocked ? 'py-3' : 'py-4 sm:py-5',
                showScriptSheet && 'py-3 sm:py-4',
              )}
            >
              {!showScriptOverApp ? (
                <GiftSeal
                  size={40}
                  showText={false}
                  className={cn('mx-auto mb-2 hidden shrink-0 lg:block', presenterDocked && 'lg:hidden')}
                />
              ) : null}

              <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
                {!showScriptSheet && (
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold sm:text-xs ${PHASE_TONE[step.phase]}`}>
                    {step.phase}
                  </span>
                )}
                <span className="text-[11px] font-medium text-muted-foreground sm:text-xs">
                  Step {idx + 1} / {STEPS.length}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground sm:text-xs">
                  <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> {step.clock}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold tabular-nums sm:text-sm ${
                    overBudget ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {fmt(elapsed)} <span className="font-normal opacity-60">/ 5:00</span>
                </span>
              </div>

            <h3
              className={cn(
                'font-bold leading-tight tracking-tight text-foreground',
                isTechHeroBeat && !presenterDocked && !showScriptSheet
                  ? 'mt-3 text-2xl sm:mt-4 sm:text-3xl'
                  : isDecisionTableBeat && !presenterDocked && !showScriptSheet
                    ? 'mt-3 text-2xl sm:mt-4 sm:text-3xl'
                    : presenterDocked
                    ? 'mt-2 text-lg sm:mt-3 sm:text-xl'
                    : 'mt-3 text-xl sm:mt-4 sm:text-2xl',
                showScriptSheet && 'mt-2 text-lg sm:text-xl',
              )}
            >
              {step.title}
            </h3>
            {step.subtitle && !isTechHeroBeat && (
              <p className="mx-auto mt-2 max-w-2xl text-base font-medium leading-snug text-muted-foreground sm:text-lg">
                {step.subtitle}
              </p>
            )}
              {step.punchline ? (
                <PunchlineSay
                  ref={punchlineRef}
                  {...step.punchline}
                  onStageChange={setPunchlineStage}
                />
              ) : (
                <>
                  {isTechHeroBeat && step.subtitle && step.sayLead ? (
                    <DemoTechIntro subtitle={step.subtitle} sayLead={step.sayLead} />
                  ) : null}
                  {step.say ? <DemoSay text={step.say} /> : null}
                  {step.decisionTable ? <DemoDecisionTable rows={step.decisionTable} /> : null}
                </>
              )}
              {showAdvanceCue && (
                <div className="gift-demo-advance-cue-float pointer-events-none mt-4 flex justify-end pr-1 sm:mt-5">
                  <DemoAdvanceCue className="opacity-60" />
                </div>
              )}
            </div>

            {showScriptOverApp && (
              <div className="shrink-0 border-t border-border/50 bg-card px-4 py-3 sm:px-6">
                <Button className="gift-demo-go-app w-full gap-2 font-semibold" size="lg" onClick={goToApp}>
                  <ArrowLeft className="h-5 w-5" />
                  {goLabel}
                </Button>
              </div>
            )}

            <div
              className={cn(
                'shrink-0 border-t border-border/50 px-4 py-3 text-center sm:px-6',
                (isImmersive || showScriptImmersive) ? 'bg-card' : 'bg-card/95',
              )}
            >
              {presenterControls}
            </div>
          </aside>
        </div>
      )}
        </>
      )}
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
