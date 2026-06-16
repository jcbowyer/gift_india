# 🎁 GIFT Gauge — The 5-Minute Killer Demo

> **Pitch line (open & close with it):**
> **“GIFT Gauge — Governance, Integrity & Facility Trust. We turn messy claims into trustworthy decisions.”**

This is the presenter script. The app ships with an **interactive in-app version of this
exact script** — click **✨ Demo** in the top bar (or press `g` then `d`) and the app will
walk you through every beat below, auto-navigating each screen and pacing you against the
5-minute clock. Use this doc to rehearse; use the in-app guide live.

**Total: 5:00.** Times are budgets, not handcuffs — the in-app guide shows a running clock.

---

## ⏱️ 0:00 – 0:30 · Problem (30s)

**Screen:** Trust Desk landing (`/`).

> *“NGO planners trying to save lives shouldn't have to fight ten thousand rows of messy,
> web-scraped hospital data. Here's the question that stops them cold:*
> **is this ICU real — or is it just *listed*?**
>
> *A facility writing ‘ICU’ on its website is not the same as that ICU existing. Get it wrong
> and you route a critical patient to a hospital that can't help them. Today, separating the
> real claims from the noise is manual, slow, and unauditable.”*

**Do:** Gesture at the hero stats — *facilities profiled, states covered, citations on record.*
Land the line: *“Every number here is backed by evidence you can actually read. Let me show you.”*

---

## ⏱️ 0:30 – 2:30 · Solution — live walkthrough (2 min)

The core loop: **capability + region → ranked list → deep dive on citations → override.**

### 0:30 – 0:55 · Capability + region
**Do:** Click the **ICU** capability tile. Then pick a **state** in the region filter.

> *“A planner starts the way they think: I need an **ICU**, in **this region**. That's it —
> no SQL, no spelunking through scraped HTML.”*

### 0:55 – 1:20 · Ranked list
**Do:** Let the ranked list load. Point at the trust dials and the colored signal badges.

> *“Instantly, every facility that *claims* an ICU here — ranked by how strongly that claim is
> backed by evidence. Green is **strong**, amber is **partial**, red is **weak / suspicious**.
> The number in the dial is a trust score computed in our gold tables, not a vibe.”*

### 1:20 – 1:55 · Deep dive on citations
**Do:** Expand the **top (strong)** result. Read one supporting citation aloud.

> *“Open any facility and you see the receipts — the actual citations behind the claim: JCI
> accreditation, the state registry, PMJAY empanelment, the facility's own website. Each one
> quotes a real source field with a reliability weight. **Supporting evidence in green,
> contradicting in red.** Nothing is fabricated — every snippet traces to a source row.”*

**Do:** Now switch the trust filter to **Suspicious** and expand a red one.

> *“And here's why this matters — a facility that *lists* an ICU but has **contradicting
> evidence** and a low entity-match confidence. The system doesn't hide it; it flags it,
> with the reason attached.”*

### 1:55 – 2:30 · Override (human-in-the-loop)
**Do:** Click **Override assessment**, pick a signal, type a note
(*“Confirmed by phone with the district health officer, 2 ICU beds operational”*), **Save**.

> *“But the machine isn't the final word. A planner with ground truth — a phone call, an
> inspection — **overrides** the assessment and leaves a note. That override is saved to
> Lakebase and now layers on top of the computed signal.”*

**Do:** Click **My Reviews** in the nav.

> *“Every override is logged here — an auditable trail of human judgment over the evidence.
> Governance you can actually defend.”*

---

## ⏱️ 2:30 – 3:30 · Why it matters (1 min)

**Screen:** Bounce through **Navigator** (`/navigator`) → **Scorecard** (`/scorecard`) while you talk.

> *“Four things make this trustworthy rather than just clever:*
>
> 1. **JCI as the global gold standard.** The Joint Commission International Gold Seal is the
>    most recognized international accreditation — it's the backbone of our trust taxonomy. A
>    Gold Seal maps straight to **strong** evidence.
> 2. **India focus — on purpose.** Huge population, enormous regional variation, the messiest
>    source data anywhere. If it works here, it works.
> 3. **Human-in-the-loop overrides.** The planner always has the last word, on the record.
> 4. **Built on governed data + Lakebase.** This runs on the governed Virtue Foundation
>    dataset, served from Lakebase Postgres — not a spreadsheet someone emailed around.”*

**Do (Navigator):** *“Zoom from nation to state to district — see where trustworthy capacity
actually exists, and where the deserts are.”*
**Do (Scorecard):** *“Benchmark any district against its region and the nation — turn trust into
allocation decisions.”*

---

## ⏱️ 3:30 – 4:00 · Tech (30s)

> *“Under the hood, this is a clean Databricks stack:*
>
> - **Databricks AppKit** — React + Express app, deployed as a Databricks App.
> - **Postgres Lakebase** — the live serving layer the app reads (`gold.*`), plus the override
>   log (`app.capability_overrides`).
> - **dbt medallion** — bronze → silver → gold. Raw scraped data lands in bronze; dbt promotes
>   it to the gold serving tables and derives every trust signal in SQL. Citations quote real
>   columns — never invented prose.
> - **Synthetic-to-real path** — the demo runs on a synthetic India dataset with zero external
>   deps; swap one loader and the *exact same* engine, UI, and overrides run on the governed
>   Virtue Foundation data. Nothing in the app changes.”*

---

## ⏱️ 4:00 – 4:30 · Future (30s)

> *“GIFT Gauge is **Track 1 — can this facility do what it claims?** The same governed trust
> layer feeds the other tracks lightly:*
>
> - **Track 2 · Medical Desert Planner** — the Navigator already shows where trustworthy
>   capacity is missing.
> - **Track 3 · Referral Copilot** — once you trust the capability, you can route a patient to it.
> - **Track 4 · Data Readiness** — the contradicting-evidence flags are a ready-made data-quality signal.
>
> *Trust is the foundation the other three stand on.”*

---

## ⏱️ 4:30 – 5:00 · Close (30s)

**Screen:** Back to Trust Desk (`/`).

> *“NGO planners drown in messy scraped data. We give them a ranked, cited, overridable answer
> to one question that saves lives: **is this real?***
>
> ***GIFT Gauge — Governance, Integrity & Facility Trust. We turn messy claims into trustworthy
> decisions.”***

---

## 🎬 Recording a Loom (optional, if time allows)

1. Reset state: delete any test overrides in **My Reviews** so the demo starts clean.
2. Window the browser to ~1280×800, hide bookmarks bar.
3. Launch the in-app guide (**✨ Demo**) and let it pace you — narrate the talk track above.
4. Keep it **under 5 minutes**; one continuous take beats a perfect edit.
5. Title: *“GIFT Gauge — turning messy claims into trustworthy decisions (5-min demo).”*

## ✅ Pre-flight checklist

- [ ] App running on live Lakebase (`./startup.sh`) — hero stats are non-zero.
- [ ] A known **strong** ICU facility and a known **suspicious** one in your chosen state.
- [ ] **My Reviews** cleared of rehearsal overrides.
- [ ] Network for the Navigator TopoJSON map is warm (open `/navigator` once before you start).
- [ ] **✨ Demo** guide opens and advances with `→` / `Space`.
