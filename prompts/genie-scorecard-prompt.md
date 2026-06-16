# About DevHub

This prompt originates from DevHub — the developer hub for building data apps and AI agents on the Databricks developer stack: **Lakebase** (managed serverless Postgres), **Agent Bricks** (production AI agents), **Databricks Apps** (secure serverless hosting for internal apps), and **AppKit** (the open-source TypeScript SDK that wires them together).

- Website: https://developers.databricks.com
- GitHub: https://github.com/databricks/devhub
- Report issues: https://github.com/databricks/devhub/issues

A complete index of every DevHub doc and template is at https://developers.databricks.com/llms.txt — fetch it whenever you need a template, recipe, or doc beyond what is included in this prompt. If a step in this prompt is unclear, the matching DevHub page almost certainly clarifies it.

---

# Working with DevHub prompts

Follow these rules every time you act on a DevHub prompt.

## Read first, then act

- Read the entire prompt before executing any steps. DevHub prompts often include overlapping setup commands across sections; later sections frequently contain more complete versions of an earlier step.
- Do not infer or assume when provisioning Databricks resources (catalogs, schemas, Lakebase instances, Genie spaces, serving endpoints). Ask the user whether to create new resources or reuse existing ones.
- If you run into trouble, fetch additional templates and docs from https://developers.databricks.com (the index lives at https://developers.databricks.com/llms.txt). For example, if Genie setup fails, fetch the Genie docs and templates instead of guessing.

## Implementation guidance

The template below describes **what to build**, not how to build it. Your installed Databricks agent skills contain all implementation patterns, code examples, CLI commands, and configuration needed. Use them to implement the template. Before continuing, always run `databricks aitools version`. **If skills are missing or it reports a newer release: STOP. Install skills if missing or update if outdated before proceeding — do not work around a missing or stale install.** A stale `.agents/skills/` copy silently shadows a fresh global install, so always check both scopes.

## Engage the user in a conversation

Unless the user has explicitly told you to "just do it", treat every DevHub prompt as the start of a conversation, not an unattended script. The user knows their domain best; DevHub knows the Databricks stack. Both are required to build a successful system.

Follow these rules every time you ask a question:

1. **One question at a time.** Never ask multiple questions in a single message.
2. **Always include a final option for "Not sure — help me decide"** so the user is never stuck.
3. **Prefer interactive multiple-choice UI when available.** Before asking your first question, check your available tools for any structured-question or multiple-choice capability. If one exists, **always** use it instead of plain text. Known tools by environment:
   - **Cursor**: use the `AskQuestion` tool.
   - **Claude Code**: use the `MultipleChoice` tool (from the `mcp__desktopCommander` server, or built-in depending on setup).
   - **Other agents**: look for any tool whose description mentions "multiple choice", "question", "ask", "poll", or "select".
4. **Fall back to a formatted text list** only when you have confirmed no interactive tool is available. Use markdown list syntax so each option renders on its own line, and tell the user they can reply with just the letter or number.

### Example: Cursor (`AskQuestion` tool)

```
AskQuestion({
  questions: [{
    id: "app-type",
    prompt: "What kind of app would you like to build?",
    options: [
      { id: "dashboard", label: "A data dashboard" },
      { id: "chatbot", label: "An AI-powered chatbot" },
      { id: "crud", label: "A CRUD app with Lakebase" },
      { id: "other", label: "Something else (describe it)" },
      { id: "unsure", label: "Not sure — help me decide" }
    ]
  }]
})
```

### Example: plain text fallback

Only use this when no interactive tool is available:

What kind of app would you like to build? Reply with the letter to choose:

- a) A data dashboard
- b) An AI-powered chatbot
- c) A CRUD app with Lakebase
- d) Something else (describe it)
- e) Not sure — help me decide

## Default workflow

Unless instructed otherwise, follow this workflow:

1. Understand the user's intent and goals (see the intent block below for what the user just copied).
2. Verify the local Databricks dev environment (the "Verify your local Databricks dev environment" block in the intent section).
3. Ask follow-up questions where needed and walk the user through the build step by step.
4. Build the app or agent.
5. Make it look great (see "Make it look great" below).
6. Run and test locally.
7. Deploy to production. **Ask the user for confirmation first, unless they have already given an explicit go-ahead.**
8. If deployed, run and test deployed app (see "Run and test deployed app" below).

## Make it look great

The default templates that AppKit provides are intentionally minimal — a starting point, not a finished product. **Do not stop there.** Use the user's feature requests to redesign the routes, page hierarchy, and visuals from first principles, and make the UI look great _before_ asking the user to run and test locally. Showing the user something polished early changes the conversation.

Unless the user has specified a design preference, use these defaults:

- shadcn/ui components on top of Tailwind CSS (via `@databricks/appkit-ui/react`).
- Clean hierarchy with modern spacing — not too many stacked cards.
- Modern, minimal design language.
- Databricks brand palette: `#FF3621`, `#0B2026`, `#EEEDE9`, `#F9F7F4`.

**For GIFT Gauge:** follow the existing design system in `gift_india_web/client/` — amber callouts for human-review flags, emerald/amber/red trust-signal badges, `gift-lift` / `gift-elevate` card treatments, and the GIFT Seal branding. Do not introduce a second visual language.

## Run and test deployed app

- If the `databricks-apps` skill is available, follow its `agent-browser` reference to load the deployed app and test it; otherwise install `agent-browser` (`npm install -g agent-browser`) and drive the deployed URL with it directly.
- If anything is off, fix it.
- Inspect the app logs via the Databricks CLI and fix any errors.
- Redeploy and repeat until all issues are resolved.
- Report back to the user once the deployed app is verified.

## When you run into issues

Use the GitHub CLI (if available) or generate a copy-pastable error report for the user to file at https://github.com/databricks/devhub/issues. Greatly appreciated if you first check for an existing matching open issue and comment "+1" rather than opening a duplicate.

---

# What the user just did

The user copied the prompt for a DevHub **cookbook** — **Genie Analytics App** (https://developers.databricks.com/templates/genie-analytics-app) — and tailored it for **GIFT Gauge**, an existing Databricks App in this repo.

**GIFT Gauge** (Governance, Integrity & Facility Trust) is a Virtue Foundation / Databricks for Good hackathon app that scores Indian healthcare facilities by evidence-backed capability claims. Trust signals are computed in SQL (`gold.*` via dbt); Layer 2 narration explains frozen evidence. Humans stay in the loop via planner overrides stored in Lakebase (`app.capability_overrides`).

The user wants to **enhance the Facility Scorecard** (`http://localhost:8000/scorecard`) — not scaffold a greenfield app. The scorecard already shows per-capability grades and trust signals, but it is missing the prominent **human-review flag UX** and **Ask Genie** conversational analytics that other pages in this app already pattern-match.

Your job in this conversation is to:

1. Clarify the user's **goal for this enhancement** — production polish, hackathon demo, or learning.
2. Verify the local Databricks dev environment is ready (block below).
3. Read the existing GIFT Gauge codebase first, then implement the tailored cookbook goal using your installed Databricks agent skills.

## Step 1 — Clarify intent before touching code

Ask **one** question, ideally with a multiple-choice tool:

- **Enhance the existing scorecard** (default for this prompt) — wire human-review flags, override flow, and Ask Genie into `gift_india_web/client/src/pages/ScorecardPage.tsx` without breaking Trust Gauge, Navigator, or My Reviews.
- **Full Genie Analytics App from scratch** — only if the user explicitly wants a separate minimal app; otherwise prefer the enhancement path above.
- **Just learning the pattern** — walk through how Genie + human-in-the-loop fit GIFT Gauge; do not execute commands.
- **Not sure — help me decide** — ask follow-ups about who uses the scorecard (planners vs analysts) and map back to one of the above.

## Step 2 — Pin down archetype-specific decisions

Before generating code, ask (one at a time):

- **Genie space**: create a new AI/BI Genie space on `gold.*` tables, or reuse an existing space? The app already declares the Genie plugin in `gift_india_web/appkit.plugins.json` with `DATABRICKS_GENIE_SPACE_ID`.
- **Databricks profile** to target (`databricks auth profiles`).
- **Genie placement on scorecard**: slide-over panel, bottom sheet, or dedicated tab within the scorecard route?
- **Scope today**: ship flagged-item UX + override first, then Genie — or both in one pass?

## Step 3 — Verify the local Databricks dev environment

Walk the user through the local-bootstrap block below first, even if they say their environment is already set up.

The tailored cookbook goal and codebase map are attached after the local-bootstrap block.

---

# Verify your local Databricks dev environment

A working Databricks CLI profile is the prerequisite for every step that follows. Use your installed Databricks agent skills to verify and set up the environment — _even if the user says their environment is already set up_.

When done, you will have:

- Databricks CLI `1.0.0+` installed and on `PATH`
- An authenticated CLI profile (`databricks auth profiles` shows `Valid: YES`)
- A successful smoke test (`databricks current-user me` returns your identity)
- For local app dev: `gift_india_web` dependencies installed (`npm install` in `gift_india_web/`) and the dev server reachable at `http://localhost:8000/scorecard`

---

# Existing codebase map (read before editing)

| Area | Path | Notes |
|------|------|-------|
| Scorecard page (primary target) | `gift_india_web/client/src/pages/ScorecardPage.tsx` | Route `/scorecard`. Shows facility picker, trust dial, capability rows — **does not yet** surface human-review flags or Genie. |
| Human-review UX (reuse, do not reinvent) | `gift_india_web/client/src/components/trust.tsx` | `HumanReviewBadge`, `HumanReviewCallout`, `CapabilityEvidence`, `OverrideAssessmentDialog`. |
| Review heuristics | `gift_india_web/client/src/lib/api.ts` | `humanReviewStatusForCapability()`, `humanReviewStatusForRanking()` — flags contradicting evidence, `weak_suspicious` signal, or `assessmentJson.review_recommended`. Cleared when `overrideSignal` is set. |
| Reference implementation | `gift_india_web/client/src/pages/TrustGaugePage.tsx`, `MapDrilldownPanel.tsx` | Amber left border + ring on flagged rows, `HumanReviewCallout`, "Start human review" → override dialog. **Match this UX on the scorecard.** |
| Override API | `gift_india_web/server/routes/gift_india/routes.ts` | `POST /api/overrides` persists to `app.capability_overrides` on Lakebase. |
| Genie plugin config | `gift_india_web/appkit.plugins.json` | Genie space resource key `genie-space` → `DATABRICKS_GENIE_SPACE_ID`. |
| AppKit Genie UI | `@databricks/appkit-ui` | `GenieChat`, `GenieChatInput`, etc. — see `node_modules/@databricks/appkit-ui/docs/plugins/genie.md`. |
| Server entry | `gift_india_web/server/` | Ensure `genie()` plugin is registered alongside existing gift_india routes if not already. |

---

# The cookbook the user copied (tailored for GIFT Gauge)

---
title: "Genie Analytics App — GIFT Gauge Scorecard Enhancement"
url: https://developers.databricks.com/templates/genie-analytics-app
summary: "Enhance the GIFT Gauge Facility Scorecard with prominent human-review flags, planner override flow, and an embedded Ask Genie panel for natural-language queries over governed gold.* data."
parent_app: "GIFT Gauge — gift_india_web"
local_test_url: "http://localhost:8000/scorecard"
---

## Product context

**Priya** (allocation planner) uses the scorecard to answer: *Can this hospital actually do what it claims?* When automated evidence is thin or contradictory, the UI must **not** silently present a grade — it must **flag the capability for manual human review** and offer a path to confirm with local ground truth (phone call, inspection) via the override dialog. Separately, colleagues who think in questions rather than SQL should be able to **Ask Genie** about the governed facility data without leaving the scorecard.

**Human-in-the-loop principle:** Layer 1 trust scores stay in SQL (auditable). Genie answers questions about the data — it does not replace the score or override the flag. Overrides are planner actions with notes, logged in My Reviews.

## When done, you will have

### A. Human-review flag UX on the scorecard

- **Facility-level summary** when any capability needs review: amber callout banner (e.g. "3 capabilities need manual human review before relying on this score") with count from `humanReviewStatusForCapability()`.
- **Per-capability rows** that mirror Trust Gauge / Map patterns:
  - `HumanReviewBadge` on flagged capabilities.
  - Amber left border (`border-l-4 border-l-amber-400`) and subtle ring on flagged rows in both "Group by capability" and "Group by signal type" views.
  - `HumanReviewCallout` in expanded capability detail with the specific `reason` (contradicting evidence count, weak signal, or Layer 2 `review_reason`).
  - **"Start human review"** button opening `OverrideAssessmentDialog` (via `CapabilityEvidence` or equivalent) — same flow as Trust Gauge; saved overrides clear the flag.
- **Signal-group view**: when a group contains flagged items, show a count badge and surface flagged capabilities at the top of the group or with visual distinction.
- **Empty-state clarity**: capabilities with `no_claim` remain ungraded; do not flag them for human review unless the heuristic says so.
- Add `data-demo` attributes consistent with existing demo screenshots (`human-review-flag`, `override`) for playwright walks.

### B. Ask Genie on the scorecard

- Embed **Genie conversational analytics** on `/scorecard` using AppKit's Genie plugin and `@databricks/appkit-ui` components (`GenieChat` or equivalent).
- Label the entry point **"Ask Genie"** — a button or collapsible panel that does not obscure the scorecard when closed.
- **Context-aware starter prompts** seeded with the selected facility when one is loaded, e.g.:
  - "Which capabilities at {facility name} have contradicting evidence?"
  - "How does this facility's ICU trust score compare to other hospitals in {district}?"
  - "List JCI-accredited facilities in {state} with strong ICU evidence."
- Genie space must query governed `gold.*` tables (facilities, capability assessments, evidence) — not hallucinate sources.
- Wire server plugin (`genie()` in AppKit server config), declare app resources in `databricks.yml`, and set `DATABRICKS_GENIE_SPACE_ID` for deploy.

### C. Visual polish (scorecard-specific)

- Flagged items should be **immediately scannable** — a planner glancing at the scorecard spots amber before reading grades.
- Do not clutter: one facility-level callout + per-row badges is enough; expanded rows carry the detailed reason.
- Preserve existing grade dial, signal mix bar, and group-by toggle behavior.
- Test at **`http://localhost:8000/scorecard`** with a facility that has contradicting evidence or `weak_suspicious` capabilities.

## Component: Genie Conversational Analytics (adapted)

When done, you will have:

- A configured AI/BI Genie space connected to GIFT Gauge `gold.*` data tables
- Ask Genie embedded on the Facility Scorecard route
- Server and client plugins wired with proper app resource declarations
- Human-review flag UX parity with Trust Gauge and Navigator on the same scorecard page

## Out of scope (unless the user explicitly asks)

- Recomputing trust scores with an LLM (Layer 1 stays SQL).
- Replacing the Trust Gauge or Navigator pages.
- New Lakebase schemas beyond existing `app.capability_overrides`.
- Live website crawling or new evidence ingestion.

## Suggested implementation order

1. Read `ScorecardPage.tsx` and the Trust Gauge / `MapDrilldownPanel` flag patterns side by side.
2. Add `humanReviewStatusForCapability` + existing trust components to scorecard rows and header.
3. Wire `CapabilityEvidence` / override dialog so "Start human review" persists to `/api/overrides`.
4. Register Genie server plugin if missing; add Ask Genie panel to scorecard.
5. Run locally, load `/scorecard`, verify flags appear on a known flagged facility and Genie responds.
6. Deploy only after user confirmation; smoke-test deployed URL the same way.

## Acceptance checklist

- [ ] Open `http://localhost:8000/scorecard` — flagged capabilities show amber badge, border, and callout with reason.
- [ ] "Start human review" opens override dialog; saving clears the flag and appears in `/reviews`.
- [ ] Facility with zero flags shows no alarming callout (clean state).
- [ ] "Ask Genie" opens chat; starter prompts reference the selected facility.
- [ ] Genie answers use SQL over governed data (inspect attached query in Genie UI).
- [ ] No regressions on `/`, `/navigator`, or `/reviews`.
