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

## ⏱️ 1:25 – 2:55 · Solution — live walkthrough (1½ min)

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

### 2:05 – 2:25 · Deep dive on citations
**Do:** Expand the **top (strong)** result. Read one supporting citation aloud.

> *"Open any facility and you see the receipts — the actual citations behind the claim: JCI
> accreditation, the state registry, PMJAY empanelment, the facility's own website. Each one
> quotes a real source field with a reliability weight. **Supporting evidence in green,
> contradicting in red.** Nothing is fabricated — every snippet traces to a source row."*

**Do:** Now switch the trust filter to **Suspicious** and expand a red one.

> *"And here's why this matters — a facility that *lists* an ICU but has **contradicting
> evidence** and a low entity-match confidence. The system doesn't hide it; it flags it,
> with the reason attached."*

### 2:25 – 2:45 · Override (human-in-the-loop)
**Do:** Click **Override assessment**, pick a signal, type a note
(*"Confirmed by phone with the district health officer, 2 ICU beds operational"*), **Save**.

> *"But the machine isn't the final word. A planner with ground truth — a phone call, an
> inspection — **overrides** the assessment and leaves a note. That override is saved to
> Lakebase and now layers on top of the computed signal."*

### 2:45 – 2:55 · An auditable trail

**Screen:** **My Reviews** (`/reviews`).

> *"Every override is logged here — an auditable trail of human judgment over the evidence.
> Governance you can actually defend."*

---

## ⏱️ 2:55 – 3:30 · Why it matters (35s)

**Screen:** Bounce through **Navigator** (`/navigator`) → **Scorecard** (`/scorecard`) while you talk.

> *"Four things make this trustworthy rather than just clever:*
>
> 1. **JCI as the global gold standard.** The Joint Commission International Gold Seal is the
>    most recognized international accreditation — it's the backbone of our trust taxonomy. A
>    Gold Seal maps straight to **strong** evidence.
> 2. **India focus — on purpose.** Huge population, enormous regional variation, the messiest
>    source data anywhere. If it works here, it works.
> 3. **Human-in-the-loop overrides.** The planner always has the last word, on the record.
> 4. **Built on governed data + Lakebase.** This runs on the governed Virtue Foundation
>    dataset, served from Lakebase Postgres — not a spreadsheet someone emailed around."*

**Do (Navigator):** *"Zoom from nation to state to district — see where trustworthy capacity
actually exists, and where the deserts are."*
**Do (Scorecard):** *"Benchmark any district against its region and the nation — turn trust into
allocation decisions."*

---

## ⏱️ 3:30 – 3:50 · How the trust dial works — Layer 1 scoring (20s)

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

## ⏱️ 3:50 – 4:05 · SQL scores, AI explains — the narration prompt (15s)

**Screen:** Trust Gauge (`/`) — immersive.

> *"Layer 2 is where AI enters — but only as a **translator**, not a judge.*
>
> *We build a frozen `evidence_context` block in SQL — facility facts, supporting and
> contradicting counts, the pre-computed score and tier — and hand it to the narration agent
> with one hard rule: **use the numbers exactly as provided; do not recompute.***
>
> *The prompt embeds the same grading rubric as the SQL. It maps tier → planner verdict —
> Confirmed, Likely, Needs review, Unsupported — and **caps at Needs review** whenever
> contradicting evidence or a `weak_suspicious` trust signal is present.*
>
> *Swap the model, change the prose card — the dial does not move. SQL supervises the LLM;
> Priya supervises both."*

**Do:** Optional — expand a facility with a narration card and point at the verdict line
matching the dial.

---

## ⏱️ 4:05 – 4:20 · Where we're improving next — JCI cross-ref & anomaly detection (15s)

**Screen:** Trust Gauge (`/`) — immersive.

> *"Today's pilot is honest about its edges — and that's where the roadmap gets interesting.*
>
> **JCI cross-referencing** — we already resolve JCI Gold Seal organizations onto governed
> `facility_id`s with tiered matching: exact name + state, then brand + city, then brand +
> state — each with `match_method` and `match_confidence`. Next: tighten the crosswalk with
> portal verification, accreditation **scope** (which services the seal actually covers), and
> surface *why* JCI attached to this row in the citation panel.
>
> **Anomaly detection** — the same signals that rank facilities are a ready-made fraud radar:
> claimed ICU with no specialty corroboration, high bed count but `weak_suspicious` entity
> match, supporting website copy contradicted by registry rows. We flag them today; tomorrow
> we batch-score districts for **systematic gaming patterns** — facilities that look fine in
> isolation but cluster as outliers against their peers.
>
> *Trust scoring is the foundation; cross-source validation and anomaly surfacing are how we
> keep gaming the directory from becoming gaming the patient."*

**Do:** Brief pause on *"fraud radar"* — then advance to the technical stack beats.

---

## ⏱️ 4:20 – 4:35 · Built on Lakehouse (15s)

**Human-in-the-loop · why we defy the AI-default**

> *"Everyone defaults to chatbots. We treat AI as an extractor, Splink before identity
> guesswork, and platform-native tooling before franken-code."*

> *"We're not building on duct tape and prayers — the Databricks Lakehouse is our foundation.*
>
> - **MDM & Lakebase** — we treat data like a product; deduplicated hospitals with verified
>   accreditation, surfaced through AgentBricks `ai_query`.
> - **Grounded verification** — autonomous agents crawl live sites and cross-reference CMS and
>   accreditation boards. We look for the gap between what they claim and what they can prove.
> - **Databricks Apps & Genie** — a secure clinical navigator that's read the compliance library.
> - **AgentBricks** — classify intent before we query; a **supervisor agent** forces the paper trail."*

---

## ⏱️ 4:35 – 4:50 · Tech stack: Decisions we made for ourselves (15s)

**Screen:** Immersive title card — decision matrix only.

| Decision Area | Our Human-in-the-Loop Approach | Why It Defies the AI-Default |
|---------------|--------------------------------|------------------------------|
| **AI_Classify vs. AI_Query** | We treat AI as an extractor (structured data), not a conversationalist. | Avoids hallucinated "answers" and conversational fluff; forces database-ready outputs. |
| **Batching & Model Selection** | Cost-optimized routing: simple tasks to small models, complex to "heavy" models. | Prevents model bloat and stops overspending on low-complexity routine tasks. |
| **Data Augmentation** | We use Splink for probabilistic record linkage before AI processing. | AI doesn't "guess" identities; we rely on proven statistical models to ensure data quality first. |
| **Native Platform Leverage** | We use Dabs, Genie, AI_Query, and Lakehouse FTS for everything possible. | We minimize "franken-coding" by relying on platform-native infrastructure rather than custom scripts. |

**Do:** Scan the table — land on **AI_Classify vs. AI_Query** and **Splink before AI processing**.

---

## ⏱️ 4:50 – 5:00 · The "30 years" problem: Call to Action (10s)

> *"There's a massive difference between 30 years of experience and one year repeated 30 times.
> Databricks isn't just storage — it's how we turn learning into an ontology of decisions. We
> capture the why behind the what, keep humans in the loop, and scale expertise planners can
> actually defend."*

---

## ⏱️ 5:00 – 5:08 · Future (8s)

> *"GIFT Gauge is **Track 1 — can this facility do what it claims?** The same governed trust
> layer feeds the other tracks lightly:*
>
> - **Track 2 · Medical Desert Planner** — the Navigator already shows where trustworthy
>   capacity is missing.
> - **Track 3 · Referral Copilot** — once you trust the capability, you can route a patient to it.
> - **Track 4 · Data Readiness** — the contradicting-evidence flags are a ready-made data-quality signal.
>
> *Trust is the foundation the other three stand on."*

---

## ⏱️ 5:08 – 5:30 · Closing the loop (22s)

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

- [ ] App running on live Lakebase (`./startup.sh`) — hero stats are non-zero.
- [ ] A known **strong** ICU facility and a known **suspicious** one in your chosen state.
- [ ] **My Reviews** cleared of rehearsal overrides.
- [ ] Network for the Navigator TopoJSON map is warm (open `/navigator` once before you start).
- [ ] **✨ Demo** guide opens on the title slide and advances with `→` / `Space`.
