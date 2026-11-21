# Beyond the Hospital Directory

**Grounding Improved Patient Care**

**John Bowyer · Mason Bushyeager · Billy Houston**

> **GIFT Gauge — Governance, Integrity & Facility Trust. We turn messy claims into trustworthy decisions.**

This is the presenter script. The app ships with an **interactive in-app version** — click **✨ Demo**
in the top bar (or press `g` then `d`) and the app walks you through every beat below,
auto-navigating each screen and pacing you against the clock. Use this doc to rehearse; use the
in-app guide live.

**Total: ~3:00** — focused on what makes GIFT Gauge unique: third-party evidence, Splink dedupe, SQL trust scores, human overrides.

---

## ✅ What's live in this build (demo on what finished)

| Layer | Status | Numbers to cite |
|-------|--------|-----------------|
| **Layer 1 · SQL trust scores** | ✅ **Done** | **9,959** real facilities · **33,722** claimed capabilities scored · **159k** citations from facility records |
| **NABH crosswalk** | ✅ **Done** | **2,363** facilities matched to [NABH](https://nabh.co/) accreditation |
| **Geography linkage** | ✅ **Done** | **`gold.facility_geography`** — tiered district match + spatial fallback; **Data Quality → Geography & map** |
| **ABDM / NHPR registry crosswalk** | ✅ **Done** | Self-reported Virtue rows entity-resolved to [ABDM's National Health Facility Registry](https://dashboardbeta.abdm.gov.in/abdm/model-abdm) — third-party registration, not self-claimed |
| **JCI crosswalk** | 🟡 **Pilot** | **11** facilities matched (seed loaded; full portal cross-ref is roadmap) |
| **Website crawl** | 🟡 **Pilot** | **34** successful page snapshots (pilot districts; national crawl in progress) |
| **Layer 2 · LLM narration** | 🟡 **Partial** | **35** real `databricks-gpt-oss-20b` cards · **~3,930** deterministic **stub** cards for pilot districts |

**Demo rule:** Lead with **third-party registry crosswalk + SQL dials + human overrides**. Don't tour every screen — land the differentiators.

**Strong ICU picks for live demo:** **Maharashtra** (156 strong), **Tamil Nadu** (81), **Uttar Pradesh** (80).

**What we do that's unique (sound bites):**

1. **Third-party registry matching** — We don't trust self-reported website copy alone. We entity-resolve Virtue facilities against India's official registries: [ABDM / NHPR](https://dashboardbeta.abdm.gov.in/abdm/model-abdm) for national health-facility registration and [NABH](https://nabh.co/) for hospital accreditation — so citations carry **third-party** evidence, not marketing pages.
2. **Splink dedupe & merge** — Probabilistic linkage across bronze sources (`virtue`, `nabh`, `jci`, `pmjay`, `nhpr`) surfaces **merge recommendations** with match scores; planners approve before anything lands in gold.
3. **SQL-first trust + human overrides** — The dial is auditable SQL; automated flags surface conflicts; the planner always has the last word, saved for audit.

---

## ⏱️ 0:00 – 0:20 · Title slide — Before / After

**Screen:** Trust Gauge landing (`/`) — process improvement slide with Before and After panels.

**Say first (one beat):** *"Directories give you lists — **where** hospitals claim to be. Priya needs **whether** they can actually deliver."*

> **Before:** Hospital directories answer *where* — 847 ICUs on a spreadsheet, half duplicate entities, stale locations, or self-reported website copy nobody verified.
>
> **After:** GIFT Gauge answers *whether* — every claim scored against third-party registries (**NABH**, **ABDM/NHPR**), Splink dedupe with human approval, and overrides on the record. Citations you can defend in a hearing.
>
> **John Bowyer · Mason Bushyeager · Billy Houston** — Databricks for Good, Virtue Foundation, **GIFT Gauge** Track 1

**Do:** Bridge with the one-liner above, then read Before, then After. *Where* = lists and pins; *whether* = defensible capability claims — don't advance until that lands.

---

## ⏱️ 0:20 – 0:32 · Priya's User Story

**Screen:** Trust Gauge landing (`/`).

> *"We're building for **Priya** — she places patients and steers referrals across India. A patient needs an **ICU** tonight. Her job isn't to browse hospital websites; it's to pick a facility she can **defend** when a district officer asks *why*. Routing wrong isn't a data-quality bug. **It's a patient-safety failure.**"*

**Do:** Name Priya. One beat on *patient-safety failure* — then advance.

---

## ⏱️ 0:32 – 0:40 · Geography & the Data Quality desk

**Screen:** **Data Quality** (`/data-quality`) — Summary tab, **Geography linked** card.

> *"A wrong district plots the ICU in the wrong state — not a spreadsheet typo, a **routing error**. We link facilities to Survey of India districts via **`gold.facility_geography`** and track gaps on the **Data Quality** desk before Priya trusts the Navigator map."*

**Do:** Point at the **Geography linked** KPI on Summary (district map rate + % facilities with `geography_id`). Then return to Trust Gauge.

---

## ⏱️ 0:40 – 0:48 · The burning question

**Screen:** Trust Gauge landing (`/`).

> ***Can this hospital actually do what it claims?***
>
> ***GIFT Gauge*** *scores each facility by the evidence behind its claims, with citations you can open, challenge, and override."*

**Do:** Gesture at the hero stats.

---

## ⏱️ 0:42 – 1:52 · Solution — live walkthrough (~70 sec)

The core loop: **capability + region → ranked list → third-party citations → flag → override → audit trail.**

### 0:42 – 0:52 · Capability + region
**Do:** Click the **ICU** capability tile. Pick a **state**.

> *"Capability + region. No SQL."*

### 0:52 – 1:04 · Ranked list
**Do:** Point at trust dials and signal badges.

> *"Every claim ranked by **`evidence_strength_score`** in SQL — not vibes."*

### 1:04 – 1:22 · Third-party evidence
**Do:** Expand a **strong** ICU in **Maharashtra**. Read a NABH or registry citation aloud.

> *"We entity-resolve Virtue rows against **NABH** (**2,300+** facilities) and **ABDM/NHPR** — third-party registration, not self-reported website copy. Supporting in green, contradicting in red. **Nothing fabricated.**"*

### 1:22 – 1:32 · Automated flagging
**Do:** Switch trust filter to **Suspicious**. Point at Human review badge + reason.

> *"System surfaces conflicts — human decides."*

### 1:32 – 1:42 · Override
**Do:** **Override assessment** → note → **Save**.

> *"Flag fired automatically; Priya still has the last word. **SQL supervises the model; humans supervise both.**"*

### 1:42 – 1:52 · Auditable trail
**Screen:** **My Reviews** (`/reviews`).

> *"Every override logged — governance you can defend."*

---

## ⏱️ 1:52 – 2:07 · Splink dedupe, geography & registry crosswalk

**Screen:** **Data Quality** (`/data-quality?tab=geography`) — **Geography & map** tab.

**Do:** Scan geography KPIs and coverage map; expand a state with unmapped districts, or switch to **Duplicate finder** for Splink merge pairs.

> *"Directories silently merge duplicates and mis-plot locations. We don't. **Geography & map** shows district linkage from **`facility_geography`**; **Splink** surfaces merge recommendations — planner approval before gold."*

---

## ⏱️ 2:07 – 2:19 · How the trust dial works

**Screen:** Trust Gauge (`/`) — immersive.

> *"**45%** supporting ratio, **25%** evidence breadth, **30%** facility match confidence — all SQL. Priya can reproduce it in a hearing."*

---

## ⏱️ 2:19 – 2:33 · Agent Bricks — extract & narrate

**Screen:** Trust Gauge (`/`) — immersive slide (✨ Demo step 12).

> *Everyone reaches for **`ai_classify`** to label rows strong or weak. We don't. Priya needs a score she can **reproduce in a hearing** — so SQL decides, Agent Bricks extracts and explains.*

**Three cards (left → right):**

1. **`ai_parse_document` + `ai_extract`** — NABH certificate PDFs on a UC volume → structured scope fields → `bronze` → dbt crosswalk. Semi-structured PDF, not a clean table.
2. **`ai_query`** — Layer 2 over frozen `evidence_context` → strict JSON schema + Markdown → `gold.capability_evidence_json` → Lakebase. *Use the numbers EXACTLY — do not recompute.*
3. **Not `ai_classify`** — we don't let an LLM label Strong/Weak ICU into gold. Fixed labels drift and aren't defensible in a district hearing.

> *SQL supervises the model; humans supervise both. Swap the narration model — the dial never moves.*

Full presenter notes: [`docs/demo/databricks-agent-bricks-slide.md`](docs/demo/databricks-agent-bricks-slide.md)

---

## ⏱️ 2:33 – 2:45 · Built on Lakehouse

> *"Everyone defaults to chatbots. We treat AI as an extractor, Splink before identity guesswork, SQL trust scores before model vibes. **MDM & Lakebase**, **third-party registries**, **Databricks Apps** — the desk Priya opens instead of the spreadsheet."*

---

## ⏱️ 2:45 – 3:00 · Closing the loop

**Screen:** Back to Trust Gauge (`/`).

> *"Huge thanks to Databricks and the Virtue Foundation. Third-party evidence, Splink dedupe, SQL scores, human overrides — so planners stop guessing and start steering.*
>
> ***GIFT Gauge — Governance, Integrity & Facility Trust.***

**Do:** Pause. Land the tagline.

---

## 🎬 Recording a Loom (optional)

1. Reset state: delete test overrides in **My Reviews**.
2. Window ~1280×800, hide bookmarks bar.
3. Launch **✨ Demo** — narrate the talk track above.
4. Keep it **under ~3:00**; one continuous take beats a perfect edit.

## ✅ Pre-flight checklist

- [ ] App running (`./startup.sh` or `make web`) — hero stats show **~10k** facilities.
- [ ] **Layer 1 built:** `make load-real && make dbt` — trust dials populated.
- [ ] Demo state: **Maharashtra** ICU (strong rows) + one **Suspicious** row.
- [ ] **My Reviews** cleared of rehearsal overrides.
- [ ] **Data Quality** warmed — Summary shows geography card; **Geography & map** tab loads (`/data-quality?tab=geography`).
- [ ] **✨ Demo** opens on title slide with Before / After panels.
