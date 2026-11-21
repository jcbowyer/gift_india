import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, Label, Switch } from '@databricks/appkit-ui/react';
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
 * Interactive ~3:00 demo walkthrough — the in-app twin of DEMO.md.
 *
 * Drives the presenter through the killer-demo script: auto-navigates to the
 * right screen for each beat, spotlights the relevant UI (when a `selector` is
 * given and present), and paces against a 3:00 clock. App-focus steps use the
 * bottom chrome bar — toggle **Show script** (or press `s`) instead of back/forward buttons.
 *
 * Launch via the header "✨ Demo" button (window event `gift-demo:start`),
 * the floating pill, or the keyboard chord `g` then `d`. Advance with → / Space,
 * go back with ←, exit with Esc.
 */

type Phase = 'Title' | 'Open' | 'Problem' | 'Solution' | 'Why it matters' | 'Tech' | 'Future' | 'Close';

interface ProcessImprovement {
  /** Optional banner above the Before / After columns. */
  header?: string;
  before: string;
  after: string;
  footer?: string;
}

/** Databricks Agent Bricks beat — ai_parse_document, ai_query, why not ai_classify. */
interface AgentBricksBeat {
  header?: string;
  parseDocument: { title: string; role: string; why: string };
  aiQuery: { title: string; role: string; why: string };
  notClassify: { title: string; role: string; why: string };
  footer?: string;
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
  /** Title slide — standard before / after process improvement layout. */
  processImprovement?: ProcessImprovement;
  /** Databricks Agent Bricks architecture slide (extract, narrate, not classify). */
  agentBricks?: AgentBricksBeat;
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
}

const STEPS: Step[] = [
  {
    phase: 'Title',
    clock: '0:00 – 0:25',
    title: 'Beyond the Hospital Directory',
    subtitle: 'Grounding Improved Patient Care',
    route: '/',
    sayLead:
      'Directories give you lists — **where** hospitals claim to be. Priya needs **whether** they can actually deliver.',
    processImprovement: {
      header: 'Where on a list — or whether on the record?',
      before:
        'Hospital directories answer **where** — 847 ICUs on a spreadsheet, half duplicate entities, stale locations, or self-reported website copy nobody verified.',
      after:
        'GIFT Gauge answers **whether** — every claim scored against third-party registries (**NABH**, **ABDM/NHPR**), Splink dedupe with human approval, and overrides on the record. Citations you can defend in a hearing.',
      footer:
        '**John Bowyer · Mason Bushyeager · Billy Houston** — Databricks for Good, Virtue Foundation, **GIFT Gauge** Track 1.',
    },
    do: [
      'Say the bridge line first — where = lists and pins; whether = defensible capability claims.',
      'Read Before, then After. Do not advance until the contrast lands.',
    ],
  },
  {
    phase: 'Open',
    clock: '0:20 – 0:32',
    title: 'Priya\'s User Story',
    route: '/',
    say: 'We’re building for **Priya** — she places patients and steers referrals across India. A patient needs an **ICU** tonight. Her job isn’t to browse hospital websites; it’s to pick a facility she can **defend** when a district officer asks *why*. Routing wrong isn’t a data-quality bug. **It’s a patient-safety failure.**',
    do: ['Name Priya if you can.', 'Pause before “patient-safety failure.”'],
  },
  {
    phase: 'Problem',
    clock: '0:32 – 0:40',
    title: 'Geography & the Data Quality desk',
    route: '/data-quality',
    say: 'A wrong district plots the ICU in the wrong state — not a spreadsheet typo, a **routing error**. We link facilities to Survey of India districts via **`gold.facility_geography`** (tiered entity resolution + spatial fallback) and track gaps on the **Data Quality** desk before Priya trusts the Navigator map.',
    do: [
      'Land on Data Quality → Summary.',
      'Point at the **Geography linked** card — district map rate and % facilities with a geography_id.',
    ],
    selector: '[data-demo="dq-summary"]',
    appFocus: true,
    scriptFirst: false,
    appGoLabel: 'Back to Trust Gauge',
  },
  {
    phase: 'Problem',
    clock: '0:40 – 0:48',
    title: 'The burning question',
    route: '/',
    say: '**Can this hospital actually do what it claims?** **GIFT Gauge** — Governance, Integrity and Facility Trust — scores each facility by the evidence behind its claims, with citations you can open, challenge, and override.',
    selector: '[data-demo="hero"]',
    appFocus: true,
    scriptFirst: false,
  },
  {
    phase: 'Solution',
    clock: '0:42 – 0:52',
    title: 'Capability + region',
    route: '/',
    say: 'A planner starts the way they think: I need intensive care, in this region. No SQL, no spelunking through scraped hospital websites.',
    do: ['Click the ICU capability tile.', 'Pick a state in the region filter below.'],
    selector: '[data-demo="capabilities"]',
    appFocus: true,
    scriptFirst: false,
  },
  {
    phase: 'Solution',
    clock: '1:10 – 1:25',
    title: 'Ranked by evidence',
    route: '/',
    say: 'Every hospital claiming intensive care here — ranked by how strongly the claim is backed. Green strong, amber partial, red suspicious. The dial is **`evidence_strength_score`** in SQL, not a vibe.',
    do: ['Point at the trust dials and the colored signal badges.'],
    selector: '[data-demo="results"]',
    appFocus: true,
    scriptFirst: false,
  },
  {
    phase: 'Solution',
    clock: '1:04 – 1:22',
    title: 'Third-party evidence — not website copy',
    route: '/',
    say: 'This is what makes us different. We don’t trust self-reported marketing pages alone — we entity-resolve Virtue rows against **NABH** (**2,300+** facilities) and **ABDM/NHPR** national registration. Open a strong ICU in **Maharashtra** — governed columns, entity-match confidence, accreditation flags. Supporting in green, contradicting in red. **Nothing fabricated.**',
    do: ['Expand a strong ICU in Maharashtra or Tamil Nadu.', 'Read a NABH or registry citation aloud.'],
    selector: '[data-demo="results"]',
    appFocus: true,
    scriptFirst: false,
  },
  {
    phase: 'Solution',
    clock: '1:22 – 1:32',
    title: 'Automated flagging',
    route: '/',
    say: 'The system surfaces conflicts — Priya doesn’t hunt. Switch to **Suspicious**: amber **Human review** badge, left border, and the **reason** on the row. Automated surfacing; human judgment on what to do next.',
    do: ['Switch trust filter to Suspicious.', 'Point at Human review badge + reason on a red row.'],
    selector: '[data-demo="results"]',
    appFocus: true,
    scriptFirst: false,
  },
  {
    phase: 'Solution',
    clock: '1:32 – 1:42',
    title: 'Human-in-the-loop override',
    route: '/',
    say: 'The flag fired automatically — Priya still has the last word. Ground truth from a phone call or inspection **overrides** the assessment with a note. Saved to Lakebase, layered on the computed signal. **SQL supervises the model; humans supervise both.**',
    do: ['Click “Override assessment”.', 'Pick a trust signal; add a note; save.'],
    selector: '[data-demo="override"]',
    appFocus: true,
    scriptFirst: false,
  },
  {
    phase: 'Solution',
    clock: '1:42 – 1:52',
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
    clock: '1:52 – 2:07',
    title: 'Splink dedupe, geography & registry crosswalk',
    route: '/data-quality?tab=geography',
    say: 'Directories silently merge duplicates and mis-plot locations. We don’t. **Geography & map** shows district linkage from **`facility_geography`** — click gaps to see unmapped districts. **Splink** surfaces **merge recommendations** across bronze sources; planners approve before gold. Registry crosswalks (NABH, NHPR) sit alongside — no duplicate ghosts on the map.',
    do: [
      'Scan Geography KPIs and the coverage map.',
      'Expand a state with unmapped districts, or switch to Duplicate finder for Splink pairs.',
    ],
    selector: '[data-demo="geography-coverage"]',
    appFocus: true,
    scriptFirst: false,
    appGoLabel: 'Back to app',
  },
  {
    phase: 'Why it matters',
    clock: '2:07 – 2:19',
    title: 'How the trust dial works',
    route: '/',
    say: 'The dial is **`evidence_strength_score`** — entirely in SQL. Priya can reproduce it in a hearing. Three auditable inputs: **45%** supporting ratio, **25%** evidence breadth, **30%** facility match confidence. Each contradicting item applies a **0.8×** penalty. Strong, Moderate, Weak, Insufficient — green, amber, red.',
    do: ['Land on “reproduce it in a hearing.”'],
  },
  {
    phase: 'Tech',
    clock: '2:19 – 2:33',
    title: 'Agent Bricks — extract & narrate',
    subtitle: 'Classify in SQL · narrate with ai_query · parse PDFs with ai_parse_document',
    route: '/',
    sayLead:
      'Everyone reaches for **ai_classify** to label rows strong or weak. We don\'t — Priya needs a score she can **reproduce in a hearing**.',
    agentBricks: {
      header: 'Right Agent Bricks function, right layer',
      parseDocument: {
        title: 'ai_parse_document + ai_extract',
        role: 'NABH certificate PDFs on a UC volume → structured scope fields → bronze → dbt crosswalk',
        why: 'Accreditation evidence is semi-structured PDF, not a clean table. Parse in SQL once; score deterministically.',
      },
      aiQuery: {
        title: 'ai_query',
        role: 'Layer 2 over frozen evidence_context → strict JSON schema + Markdown → gold tables → Lakebase',
        why: 'Database-ready assessment objects for the citation panel. Prompts: use the numbers EXACTLY — do not recompute.',
      },
      notClassify: {
        title: 'Not ai_classify',
        role: 'We do not let an LLM label Strong / Weak ICU and load that to gold',
        why: 'Fixed labels are opaque, drift run-to-run, and unsafe for routing. Trust tiers stay in auditable SQL.',
      },
      footer:
        '**SQL supervises the model; humans supervise both.** Swap the narration model — the dial never moves.',
    },
    do: [
      'Land on “reproduce in a hearing” — then walk the three cards left to right.',
      'Point at ai_query landing JSON in gold.capability_evidence_json.',
    ],
  },
  {
    phase: 'Tech',
    clock: '2:33 – 2:45',
    title: 'Built on Lakehouse',
    subtitle: 'Human-in-the-loop · why we defy the AI-default',
    subtitleLarge: true,
    route: '/',
    sayLead:
      'Everyone defaults to chatbots. We treat AI as an extractor, Splink merge recommendations before identity guesswork, and SQL trust scores before model vibes.',
    say: '**MDM & Lakebase** — bronze per source, human-approved merges into gold. **Grounded verification** — third-party registries, not marketing pages. **Databricks Apps** — the desk Priya opens instead of the spreadsheet.',
    do: ['Keep it tight — land on third-party evidence and human-in-the-loop.'],
  },
  {
    phase: 'Close',
    clock: '2:45 – 3:00',
    title: 'Closing the loop',
    route: '/',
    say: 'Huge thanks to Databricks and the Virtue Foundation. We’re building the plumbing so planners stop guessing and start steering — third-party evidence, Splink dedupe, SQL scores, human overrides. The best way to change the world isn’t to look for a magic solution — **it’s to try.** **GIFT Gauge** — Governance, Integrity and Facility Trust.',
    do: ['Pause. Ask: which would your team feel first — trustworthy facility data or auditable referral decisions?'],
    selector: '[data-demo="hero"]',
    appFocus: true,
    scriptFirst: false,
  },
];

const TOTAL_BUDGET_SEC = 3 * 60;
const DEMO_BUDGET_LABEL = '3:00';

/** Parse demo clock windows like `0:45 – 1:05` into seconds on the 3:00 timeline. */
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

function ProcessImprovementSlide({ header, before, after, footer }: ProcessImprovement) {
  return (
    <div className="mx-auto mt-4 max-w-4xl text-left sm:mt-5">
      {header ? (
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-sm">
          {header}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        <section className="overflow-hidden rounded-xl border border-red-200/80 bg-gradient-to-b from-red-50/90 to-orange-50/40 shadow-sm">
          <div className="border-b border-red-200/60 bg-red-50/80 px-3 py-2 sm:px-4 sm:py-2.5">
            <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-red-800/90 sm:text-sm">Before</h4>
          </div>
          <p className="px-3 py-3 text-base leading-snug text-foreground/85 sm:px-4 sm:py-3.5 sm:leading-relaxed">
            {renderSayText(before)}
          </p>
        </section>
        <section className="overflow-hidden rounded-xl border border-emerald-200/80 bg-gradient-to-b from-emerald-50/90 to-teal-50/40 shadow-sm">
          <div className="border-b border-emerald-200/60 bg-emerald-50/80 px-3 py-2 sm:px-4 sm:py-2.5">
            <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-800/90 sm:text-sm">After</h4>
          </div>
          <p className="px-3 py-3 text-base leading-snug text-foreground sm:px-4 sm:py-3.5 sm:leading-relaxed">
            {renderSayText(after)}
          </p>
        </section>
      </div>
      {footer ? (
        <p className="mt-4 text-center text-sm leading-relaxed text-muted-foreground sm:text-base">
          {renderSayText(footer)}
        </p>
      ) : null}
    </div>
  );
}

function AgentBricksCard({
  tone,
  title,
  role,
  why,
}: {
  tone: 'sky' | 'indigo' | 'slate';
  title: string;
  role: string;
  why: string;
}) {
  const toneClass =
    tone === 'sky'
      ? 'border-sky-200/80 bg-gradient-to-b from-sky-50/90 to-slate-50/40'
      : tone === 'indigo'
        ? 'border-indigo-200/80 bg-gradient-to-b from-indigo-50/90 to-violet-50/40'
        : 'border-slate-300/80 bg-gradient-to-b from-slate-100/90 to-slate-50/40';
  const headerClass =
    tone === 'sky'
      ? 'border-sky-200/60 bg-sky-50/80 text-sky-900'
      : tone === 'indigo'
        ? 'border-indigo-200/60 bg-indigo-50/80 text-indigo-900'
        : 'border-slate-300/60 bg-slate-100/80 text-slate-700';
  return (
    <section className={cn('overflow-hidden rounded-xl border shadow-sm', toneClass)}>
      <div className={cn('border-b px-3 py-2 sm:px-4 sm:py-2.5', headerClass)}>
        <h4 className="font-mono text-xs font-bold sm:text-sm">{title}</h4>
      </div>
      <div className="space-y-2 px-3 py-3 text-sm leading-snug sm:px-4 sm:py-3.5 sm:text-base sm:leading-relaxed">
        <p className="text-foreground/90">{renderSayText(role)}</p>
        <p className="text-muted-foreground">{renderSayText(why)}</p>
      </div>
    </section>
  );
}

function AgentBricksSlide({ header, parseDocument, aiQuery, notClassify, footer }: AgentBricksBeat) {
  return (
    <div className="mx-auto mt-4 max-w-5xl text-left sm:mt-5">
      {header ? (
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-sm">
          {header}
        </p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-3 lg:gap-4">
        <AgentBricksCard tone="sky" {...parseDocument} />
        <AgentBricksCard tone="indigo" {...aiQuery} />
        <AgentBricksCard tone="slate" {...notClassify} />
      </div>
      {footer ? (
        <p className="mt-4 text-center text-sm leading-relaxed text-muted-foreground sm:text-base">
          {renderSayText(footer)}
        </p>
      ) : null}
    </div>
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

function DemoScriptToggle({
  scriptOpen,
  onCheckedChange,
  className,
  compact = false,
}: {
  scriptOpen: boolean;
  onCheckedChange: (open: boolean) => void;
  className?: string;
  compact?: boolean;
}) {
  const id = 'gift-demo-show-script';
  return (
    <div className={cn('inline-flex items-center gap-2 shrink-0', className)}>
      <Switch
        id={id}
        checked={scriptOpen}
        onCheckedChange={onCheckedChange}
        aria-label="Show presenter script"
      />
      <Label
        htmlFor={id}
        className={cn(
          'cursor-pointer font-medium text-foreground leading-none',
          compact ? 'text-xs' : 'text-sm',
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <ScrollText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          Show script
        </span>
      </Label>
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
  const startedAt = useRef<number | null>(null);

  const step = STEPS[idx];
  const hasSpotlight = Boolean(step.selector);
  const isAppFocus = hasSpotlight && Boolean(step.appFocus);
  const presenterDocked = hasSpotlight && !isAppFocus;
  const isImmersive = !hasSpotlight;
  const showFullscreenApp = isAppFocus && !scriptOpen;
  const showScriptOverApp = isAppFocus && scriptOpen;
  const showScriptImmersive = showScriptOverApp && scriptFirstFor(step);
  const showScriptSheet = showScriptOverApp && !scriptFirstFor(step);
  const showPresenter = isImmersive || showScriptOverApp || presenterDocked;

  const goToApp = useCallback(() => {
    const [routePath, routeSearch] = step.route.split('?');
    const wantSearch = routeSearch ? `?${routeSearch}` : '';
    if (location.pathname !== routePath || location.search !== wantSearch) {
      void navigate(step.route);
    }
    setScriptOpen(false);
  }, [location.pathname, location.search, navigate, step.route]);

  const handleScriptToggle = useCallback(
    (open: boolean) => {
      if (open) setScriptOpen(true);
      else goToApp();
    },
    [goToApp],
  );

  const start = useCallback(() => {
    setIdx(0);
    setElapsed(0);
    setScriptOpen(true);
    startedAt.current = Date.now();
    setRunning(true);
    void navigate('/');
  }, [navigate]);

  const stop = useCallback(() => {
    setRunning(false);
    setScriptOpen(true);
    startedAt.current = null;
    teardownDemo();
    window.dispatchEvent(new Event('gift-demo:stop'));
  }, []);

  const next = useCallback(() => setIdx((i) => Math.min(i + 1, STEPS.length - 1)), []);
  const prev = useCallback(() => setIdx((i) => Math.max(i - 1, 0)), []);

  const advanceStep = useCallback(() => {
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
    const [routePath, routeSearch] = step.route.split('?');
    const wantSearch = routeSearch ? `?${routeSearch}` : '';
    if (location.pathname !== routePath || location.search !== wantSearch) void navigate(step.route);
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
    if (!running || !step.selector) {
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
          handleScriptToggle(!scriptOpen);
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
  }, [running, idx, advanceStep, prev, start, stop, handleScriptToggle, scriptOpen]);

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
  const showAdvanceCue = !isLast && elapsed >= stepEndSec;
  const isTechHeroBeat = Boolean(step.subtitleLarge && step.sayLead);
  const isProcessImprovementBeat = Boolean(step.processImprovement);
  const isAgentBricksBeat = Boolean(step.agentBricks);
  const isWideImmersiveBeat = isProcessImprovementBeat || isAgentBricksBeat;

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
        <kbd className="rounded border bg-muted px-1 py-0.5">→</kbd>/<kbd className="rounded border bg-muted px-1 py-0.5">Space</kbd>{' '}
        {isLast ? 'finish' : 'next'} · <kbd className="rounded border bg-muted px-1 py-0.5">←</kbd> back ·{' '}
        <kbd className="rounded border bg-muted px-1 py-0.5">s</kbd> script ·{' '}
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
          aria-label="Start the demo walkthrough (~3:00)"
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

      {isAppFocus && (
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
                  Step {idx + 1} / {STEPS.length} · {fmt(elapsed)} / {DEMO_BUDGET_LABEL}
                </p>
              </div>
              <DemoScriptToggle
                scriptOpen={scriptOpen}
                onCheckedChange={handleScriptToggle}
                compact
              />
              <Button variant="ghost" size="sm" onClick={prev} disabled={idx === 0} aria-label="Previous step">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              {isLast ? (
                <Button size="sm" onClick={stop} className="gap-1.5 font-semibold">
                  <CheckCircle2 className="h-4 w-4" />
                  Finish
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
            showScriptSheet && isAppFocus && 'pb-[5.75rem]',
          )}
        >
          <aside
            className={cn(
              'gift-demo-presenter gift-fade-in pointer-events-auto flex flex-col overflow-hidden rounded-2xl shadow-2xl sm:rounded-3xl',
              isWideImmersiveBeat && (isImmersive || showScriptImmersive)
                ? 'w-[min(64rem,calc(100vw-1.5rem))]'
                : 'w-[min(52rem,calc(100vw-1.5rem))]',
              (isImmersive || showScriptImmersive) &&
                'gift-demo-presenter-immersive border border-slate-200 bg-white max-h-[calc(100dvh-1.5rem)]',
              showScriptSheet && 'border border-white/60 bg-card/95 backdrop-blur-md',
              presenterDocked && 'gift-demo-presenter-spotlight max-h-[min(42vh,22rem)] border border-white/60 bg-card/95 backdrop-blur-md',
              showScriptSheet && 'gift-demo-presenter-sheet max-h-[min(52vh,28rem)] w-full max-w-none rounded-b-none rounded-t-2xl sm:rounded-t-3xl',
              (step.processImprovement || step.agentBricks || step.phase === 'Title') && 'gift-demo-presenter-open',
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
                  {fmt(elapsed)} <span className="font-normal opacity-60">/ {DEMO_BUDGET_LABEL}</span>
                </span>
              </div>

            <h3
              className={cn(
                'font-bold leading-tight tracking-tight text-foreground',
                isTechHeroBeat && !presenterDocked && !showScriptSheet
                  ? 'mt-3 text-2xl sm:mt-4 sm:text-3xl'
                  : isProcessImprovementBeat && !presenterDocked && !showScriptSheet
                    ? 'mt-3 text-2xl sm:mt-4 sm:text-3xl'
                    : isAgentBricksBeat && !presenterDocked && !showScriptSheet
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
              {step.processImprovement ? (
                <>
                  {step.sayLead ? (
                    <p className="mx-auto mt-3 max-w-3xl text-base font-semibold leading-snug text-foreground sm:mt-4 sm:text-lg sm:leading-relaxed">
                      {renderSayText(step.sayLead)}
                    </p>
                  ) : null}
                  <ProcessImprovementSlide {...step.processImprovement} />
                </>
              ) : step.agentBricks ? (
                <>
                  {step.sayLead ? (
                    <p className="mx-auto mt-3 max-w-3xl text-base font-semibold leading-snug text-foreground sm:mt-4 sm:text-lg sm:leading-relaxed">
                      {renderSayText(step.sayLead)}
                    </p>
                  ) : null}
                  <AgentBricksSlide {...step.agentBricks} />
                </>
              ) : (
                <>
                  {isTechHeroBeat && step.subtitle && step.sayLead ? (
                    <DemoTechIntro subtitle={step.subtitle} sayLead={step.sayLead} />
                  ) : null}
                  {step.say ? <DemoSay text={step.say} /> : null}
                </>
              )}
              {showAdvanceCue && (
                <div className="gift-demo-advance-cue-float pointer-events-none mt-4 flex justify-end pr-1 sm:mt-5">
                  <DemoAdvanceCue className="opacity-60" />
                </div>
              )}
            </div>

            {!isAppFocus && (
              <div
                className={cn(
                  'shrink-0 border-t border-border/50 px-4 py-3 text-center sm:px-6',
                  (isImmersive || showScriptImmersive) ? 'bg-white' : 'bg-card/95',
                )}
              >
                {presenterControls}
              </div>
            )}
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
