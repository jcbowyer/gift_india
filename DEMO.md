# Beyond the Hospital Directory

**Grounding Improved Patient Care**

**John Bowyer · Mason Bushyeager · Billy Houston**

> **GIFT Gauge — Governance, Integrity & Facility Trust. We turn messy claims into trustworthy decisions.**

This is the presenter script. The app ships with an **interactive in-app version** — click **✨ Demo**
in the top bar (or press `g` then `d`) and the app walks you through every beat below,
auto-navigating each screen and pacing you against the clock. Use this doc to rehearse; use the
in-app guide live.

**Total: ~5:30** (title + grit opener + narrative beats + scoring explainer + product walkthrough).
Times are budgets, not handcuffs — compress the Lakehouse / tech table beats if you need to land at 5:00.

---

## ✅ What's live in this build (demo on what finished)

| Layer | Status | Numbers to cite |
|-------|--------|-----------------|
| **Layer 1 · SQL trust scores** | ✅ **Done** | **9,959** real facilities · **33,722** claimed capabilities scored · **159k** citations from facility records |
| **NABH crosswalk** | ✅ **Done** | **2,363** facilities matched to NABH accreditation |
| **JCI crosswalk** | 🟡 **Pilot** | **11** facilities matched (seed loaded; full portal cross-ref is roadmap) |
| **Website crawl** | 🟡 **Pilot** | **34** successful page snapshots (pilot districts; national crawl in progress) |
| **Layer 2 · LLM narration** | 🟡 **Partial** | **35** real `databricks-gpt-oss-20b` cards · **~3,930** deterministic **stub** cards for pilot districts |

**Demo rule:** Lead with **SQL dials + facility-record citations + NABH flags**. Mention JCI/crawl/LLM as *architecture shown, scale in flight* — don't imply every row has them.

**LLM note:** `make narrate-pilot` hit a Databricks **429** (*output tokens per minute* quota on `databricks-gpt-oss-20b`). The dial never depends on narration — stub cards keep the UI demo-safe offline.

**Strong ICU picks for live demo:** **Maharashtra** (156 strong), **Tamil Nadu** (81), **Uttar Pradesh** (80).

---

## ⏱️ 0:00 – 0:20 · Title slide

**Screen:** Trust Gauge landing (`/`) — immersive title card.

> **Beyond the Hospital Directory**
>
> *Grounding Improved Patient Care*
>
> **John Bowyer · Mason Bushyeager · Billy Houston**
>
> Databricks for Good hackathon in support of the Virtue Foundation — **GIFT Gauge** (Track 1)

**Do:** Hold the title. Let the room read the authors before you advance.

---

## ⏱️ 0:20 – 0:45 · Open — grit (25s)

**Screen:** Trust Gauge landing (`/`) — immersive punchline card.

> *"If you like this demo, here's the secret — it's not about technology or intelligence.
> After 30 years, we've found the number one predictor of success comes down to a single thing.*
>
> *[beat]*
>
> ***It's grit.***
>
> *Yesterday our project was struggling. Every instinct said go to dinner, go to bed, call it quits.
> We didn't quit. And today, this is what you see."*

**Do:** Pause briefly before *"It's grit."* appears (or tap to reveal). Gesture at the app on the last line.

---

## ⏱️ 0:45 – 1:05 · Priya's User Story

**Screen:** Trust Gauge landing (`/`).

> *"We're at the Databricks for Good hackathon in support of the Virtue Foundation — and we're building for **Priya**. She runs
> allocation for a nonprofit health network across India. Her job isn't to browse hospital
> websites; it's to **place patients and steer referrals** toward facilities that are clinically
> capable, cost-effective, and defensible when a district officer or donor asks *why*.*
>
> *Every morning, the same trap: her spreadsheet says 847 facilities in Uttar Pradesh claim an
> **ICU**. A patient needs one tonight. Half those rows are duplicate entities, stale locations,
> or self-reported website copy nobody has verified. She's been burned by **hospital directories**
> before — staring at a list, unable to tell if a hospital is actually equipped for the
> procedure or just **gaming the search results**.*
>
> *Routing wrong isn't a data-quality bug. **It's a patient-safety failure.**"*

**Do:** Name Priya if you can — make the persona real. Land the ICU / Uttar Pradesh numbers;
pause before *"patient-safety failure."*

---

## ⏱️ 1:05 – 1:25 · The burning question

**Screen:** Trust Gauge landing (`/`).

> *"We're here to answer one burning question that usually takes weeks of phone calls to resolve:*
> **Can this hospital actually do what it claims?**
>
> ***GIFT Gauge*** *— Governance, Integrity and Facility Trust — scores each facility by the
> evidence behind its claims, with citations you can open, challenge, and override."*

**Do:** Gesture at the hero stats — *facilities profiled, states covered, citations on record.*

---

## ⏱️ 1:25 – 3:00 · Solution — live walkthrough (~1¾ min)

The core loop: **capability + region → ranked list → deep dive on citations → override → reviews.**

### 1:25 – 1:45 · Capability + region
**Do:** Click the **ICU** capability tile. Then pick a **state** in the region filter.

> *"A planner starts the way they think: I need an **ICU**, in **this region**. That's it —
> no SQL, no spelunking through scraped HTML."*

### 1:45 – 2:05 · Ranked list
**Do:** Let the ranked list load. Point at the trust dials and the colored signal badges.

> *"Instantly, every facility that *claims* an ICU here — ranked by how strongly that claim is
> backed by evidence. Green is **strong**, amber is **partial**, red is **weak / suspicious**.
> The number in the dial is a trust score computed in our gold tables, not a vibe."*

### 2:05 – 2:20 · Deep dive on citations
**Do:** Expand the **top (strong)** result in **Maharashtra** or **Tamil Nadu**. Read one supporting citation aloud — specialties, bed count, or entity confidence from the **facility record**.

> *"Open any facility and you see the receipts — real columns from the governed Virtue dataset: on-record **specialties**, **facility type & scale**, **entity-match confidence**. Where we've finished accreditation crosswalks, you'll see **NABH** on **2,300+** facilities. Each snippet quotes a source field with a reliability weight. **Supporting in green, contradicting in red.** Nothing fabricated."*

### 2:20 – 2:35 · Automated flagging (human-in-the-loop starts here)
**Do:** Switch the trust filter to **Suspicious**. Point at the amber **Human review** badge, left border, and **reason** line on a flagged row. Expand one flagged facility.

> *"The system doesn't wait for Priya to hunt. Flagged rows get an amber **Human review** badge, a left border, and the **reason** attached — contradicting evidence, low entity-match confidence, or a Layer 2 review signal. **Automated surfacing; human judgment on what to do next.**"*

> *(Optional, one line only — don't linger:)* *"JCI Gold Seal crosswalk and live website crawl are pilot-scale today — **11** JCI matches, **34** crawled pages — the architecture is there; national coverage is the next sprint."*

### 2:35 – 2:50 · Override (human-in-the-loop)
**Do:** Click **Override assessment**, pick a signal, type a note
(*"Confirmed by phone with the district health officer, 2 ICU beds operational"*), **Save**.

> *"The flag fired automatically — Priya still has the last word. A planner with ground truth — a phone call, an
> inspection — **overrides** the assessment and leaves a note. That override is saved to
> Lakebase and now layers on top of the computed signal. **SQL supervises the model; humans supervise both.**"*

### 2:50 – 3:00 · An auditable trail

**Screen:** **My Reviews** (`/reviews`).

> *"Every override is logged here — an auditable trail of human judgment over the evidence.
> Governance you can actually defend."*

### 3:00 – 3:20 · Data Quality — web address, missing & duplicate finder

**Screen:** **Data Quality** (`/data-quality`) — user menu → Data Quality.

**Do:** Scan the **web-address coverage** KPIs. Click a state with missing URLs; expand the **missing-finder** drill-down.

> *"Track 4 starts here — **Data Quality**. The **missing finder** is live: web-address coverage from `gold.facilities`, drill any state to list facilities with **no website URL** — the crawl can't corroborate what isn't on record.*
>
> *The **duplicate finder** runs on **Splink**: probabilistic linkage across bronze `facilities_virtue`, `facilities_jci`, `facilities_nabh`, `facilities_pmjay` — **merge recommendations** with match scores, not silent gold merges. Planners approve before MDM combines rows."*

---

## ⏱️ 3:20 – 3:50 · Why it matters — Navigator & Scorecard (30s)

**Screen:** **Navigator** (`/navigator`) → **Scorecard** (`/scorecard`).

> *"Four things make this trustworthy — and all four are **live in this build**:*
>
> 1. **SQL-first trust scores** — **33,000+** claimed capabilities ranked in auditable SQL, not model vibes.
> 2. **NABH accreditation crosswalk** — **2,363** facilities resolved with match confidence on the record.
> 3. **Human-in-the-loop overrides** — automated flags surface conflicts; the planner always has the last word, saved for audit.
> 4. **Governed Virtue Foundation data** — **~10k** real facilities on Lakebase, not a forwarded spreadsheet.
>
> *India focus on purpose: huge population, wild regional variation. If entity resolution and trust scoring work here, they work anywhere."*

**Do (Navigator):** *"Zoom from nation to state to district — see where trustworthy capacity
actually exists, and where the deserts are."*
**Do (Scorecard):** *"Automated flags roll up — amber banner, Human review badges on flagged capabilities, **Ask Genie** over the same governed SQL. Benchmark a district; expand a flagged row."*

---

## ⏱️ 3:50 – 4:08 · How the trust dial works — Layer 1 scoring (18s)

**Screen:** Trust Gauge (`/`) — immersive talk track (no live clicks required).

> *"The number in the dial is not a vibe — it's **`evidence_strength_score`**, computed entirely
> in SQL in `gold.capability_scored`. Priya can reproduce it in a hearing.*
>
> *When a facility **claims** a capability, we blend three auditable inputs:*
>
> - **45% supporting ratio** — supporting evidence vs contradicting evidence
> - **25% evidence breadth** — how many independent items back the claim (capped at five)
> - **30% facility match confidence** — how sure we are this row is the right hospital
>
> *Each contradicting item applies a **0.8× penalty** — one red flag matters. Unclaimed
> capabilities score zero.*
>
> *That rolls into four tiers: **Strong** (≥0.85), **Moderate** (0.65–0.84), **Weak**
> (0.45–0.64), **Insufficient** (<0.45). Green, amber, and red on the list map to those bands."*

**Do:** Gesture at a trust dial if the list is still visible behind the script; land on
*"reproduce it in a hearing."*

---

## ⏱️ 4:08 – 4:20 · SQL scores, narration stub — Layer 2 (12s)

**Screen:** Trust Gauge (`/`) — immersive.

> *"Layer 2 is where AI would translate the frozen SQL context into prose — but the dial never waits on it.*
>
> *We build a frozen `evidence_context` block in SQL and hand it to a narration agent with one hard rule: **use the numbers exactly as provided; do not recompute.** In production that's `databricks-gpt-oss-20b` via serving endpoints.*
>
> *In this build we finished **35** real LLM narrations before Databricks returned **429** — the workspace **output-tokens-per-minute** quota on the shared foundation-model endpoint. The pilot districts still have **~3,900** deterministic **stub** cards so the UI demo never blocks on quota.*
>
> *Swap the model or hit rate limits — **the dial does not move.** SQL supervises the LLM; Priya supervises both."*

**Do:** Optional — expand a pilot-district facility; note the evidence card matches the dial tier (stub or LLM).

---

## ⏱️ 4:20 – 4:30 · What's next — JCI, crawl, LLM scale (10s)

**Screen:** Trust Gauge (`/`) — immersive.

> *"What's finished is the trust **foundation** — SQL scores, Virtue citations, NABH crosswalk, human overrides. What's scaling next:*
>
> - **JCI cross-referencing** — tiered entity resolution is built; **11** Gold Seal matches today → portal verification + accreditation **scope** on the citation panel.
> - **Website crawl** — **34** pilot pages landed → national crawl feeds first-party corroboration.
> - **LLM narration at scale** — provisioned throughput or `--serve-delay` batching past the **429** token quota; stub cards hold the demo until then.
> - **Anomaly detection** — contradicting-evidence flags today → district-level outlier scoring tomorrow.

**Do:** Brief pause on *"fraud radar"* — then advance to the technical stack beats.

---

## ⏱️ 4:30 – 4:42 · Built on Lakehouse (12s)

**Human-in-the-loop · why we defy the AI-default**

> *"Everyone defaults to chatbots. We treat AI as an extractor, Splink **merge recommendations** before identity
> guesswork, and platform-native tooling before franken-code."*

> *"We're not building on duct tape and prayers — the Databricks Lakehouse is our foundation.*
>
> - **MDM & Lakebase** — bronze `facilities_*` per source; Splink duplicate-finder scores; human-approved merges into gold.
> - **Grounded verification** — autonomous agents crawl live sites and cross-reference CMS and
>   accreditation boards. We look for the gap between what they claim and what they can prove.
> - **Databricks Apps & Genie** — a secure clinical navigator that's read the compliance library.
> - **AgentBricks** — classify intent before we query; a **supervisor agent** forces the paper trail."*

---

## ⏱️ 4:42 – 4:55 · Tech stack: Decisions we made for ourselves (13s)

**Screen:** Immersive title card — decision matrix only.

| Decision Area | Our Human-in-the-Loop Approach | Why It Defies the AI-Default |
|---------------|--------------------------------|------------------------------|
| **AI_Classify vs. AI_Query** | We treat AI as an extractor (structured data), not a conversationalist. | Avoids hallucinated "answers" and conversational fluff; forces database-ready outputs. |
| **Batching & Model Selection** | Cost-optimized routing: simple tasks to small models, complex to "heavy" models. | Prevents model bloat and stops overspending on low-complexity routine tasks. |
| **Data Augmentation** | Splink probabilistic linkage surfaces **merge recommendations** across bronze sources — humans approve before gold. | Match scores, not LLM guesswork — duplicate pairs queue for planner review; nothing silently merges. |
| **Native Platform Leverage** | We use Dabs, Genie, AI_Query, and Lakehouse FTS for everything possible. | We minimize "franken-coding" by relying on platform-native infrastructure rather than custom scripts. |

**Do:** Scan the table — land on **Splink merge recommendations** and **AI_Classify vs. AI_Query**.

---

## ⏱️ 4:55 – 5:05 · The "30 years" problem: Call to Action (10s)

> *"There's a massive difference between 30 years of experience and one year repeated 30 times.
> Databricks isn't just storage — it's how we turn learning into an ontology of decisions. We
> capture the why behind the what, keep humans in the loop, and scale expertise planners can
> actually defend."*

---

## ⏱️ 5:05 – 5:12 · Future opportunities (7s)

> *"GIFT Gauge is **Track 1 — can this facility do what it claims?** The same governed trust
> layer feeds what's next:*
>
> 1. **Navigator + beds & population** — augment the map with beds per 100k and
>    population-weighted supply metrics layered on trust scores, so gaps aren't just a low dial —
>    they're **underserved people** with thin, unverified capacity.
> 2. **Medical Desert Planner (Track 2)** — composite gap scoring where weak trust *and* low
>    beds or facilities per capita overlap in the same district.
> 3. **Referral Copilot (Track 3)** — once you trust the capability, route the patient to the
>    nearest defensible facility with an auditable rationale.
> 4. **Data Readiness Gauge (Track 4)** — contradiction flags and entity-confidence gaps as a
>    fix-list for the Virtue dataset upstream.
> 5. **District anomaly radar** — outlier scoring on facilities whose claims diverge sharply
>    from peers in the same region.
> 6. **National crawl + accreditation scope** — JCI portal verification and first-party website
>    corroboration at full national coverage.
> 7. **Planner Genie** — natural-language queries over the same SQL scores Priya can reproduce
>    in a hearing (*"show ICU deserts in eastern Uttar Pradesh"*).
>
> *Trust is the foundation everything else stands on."*

**Do:** Scan the list — land on **#1** (beds + population on the map) and **#2** (desert planner); compress if you're over 5:30.

---

## ⏱️ 5:12 – 5:30 · Closing the loop (18s)

**Screen:** Back to Trust Gauge (`/`).

> *"Huge thanks to Databricks and the Virtue Foundation. We aren't just talking about the future
> of care — we're building the plumbing so planners stop guessing and start steering.*
>
> *The best way to change the world isn't to look for a magic solution — **it's to try.***
>
> ***GIFT Gauge — Governance, Integrity & Facility Trust.***

**Do:** Pause. Ask the room: *"Lakebase foundation or AgentBricks decision-making — where would
your team feel relief first?"*

---

## 🎬 Recording a Loom (optional, if time allows)

1. Reset state: delete any test overrides in **My Reviews** so the demo starts clean.
2. Window the browser to ~1280×800, hide bookmarks bar.
3. Launch the in-app guide (**✨ Demo**) and let it pace you — narrate the talk track above.
4. Keep it **under ~5:30**; one continuous take beats a perfect edit.
5. Title: *"Beyond the Hospital Directory: Grounding Improved Patient Care (GIFT Gauge demo)."*

## ✅ Pre-flight checklist

- [ ] App running (`./startup.sh` or `make web`) — hero stats show **~10k** facilities, non-zero citations.
- [ ] **Layer 1 built:** `make load-real && make dbt` (or Lakebase equivalent) — trust dials populated.
- [ ] Demo state picked: **Maharashtra** ICU (many **strong** rows) + one **Suspicious** row for contrast.
- [ ] **My Reviews** cleared of rehearsal overrides.
- [ ] Navigator map warmed (open `/navigator` once before you start).
- [ ] **Data Quality** warmed (open `/data-quality` once; pick a state with missing URLs for drill-down).
- [ ] **✨ Demo** guide opens on the title slide; advance with `→` / `Space`.
- [ ] *Don't claim:* every facility has JCI, live website crawl, or LLM prose — cite the **finished** layers above.
