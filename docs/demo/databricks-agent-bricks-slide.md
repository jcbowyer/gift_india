# Agent Bricks on Lakehouse — extract & narrate, not classify

**GIFT Gauge · Databricks for Good · ~45 sec presenter beat**

> **Say first:** *Everyone reaches for `ai_classify` to label rows “strong” or “weak.” We don’t. Priya needs a score she can reproduce in a hearing — so SQL decides, Agent Bricks extracts and explains, and structured JSON lands in the database.*

---

## The bet (one line)

**Classify in SQL · extract from documents · narrate with `ai_query`**

The trust dial never comes from an LLM label. Agent Bricks handles messy inputs and readable outputs — not the verdict.

---

## Three functions — three layers

| Agent Bricks / SQL | What it does in GIFT | Why we use it |
|--------------------|----------------------|---------------|
| **`ai_parse_document`** (+ `ai_extract`) | NABH certificate PDFs on a UC volume → scope text → structured fields (`hospital_name`, accredited capabilities, validity dates) | Accreditation evidence is **semi-structured PDF**, not a clean table. Parse once in SQL, land rows in `bronze.nabh_certificate_extractions`, then **deterministic** capability cross-check in dbt. |
| **`ai_query`** | Layer 2 narration over **frozen** `evidence_context` from `gold.capability_scored` → strict JSON schema + Markdown card | We need **database-ready** assessment objects (`gold.capability_evidence_json`) the app can join — not chat prose. `responseFormat` enforces schema; prompts say *“use the numbers EXACTLY as provided — do not recompute.”* |
| **~~`ai_classify`~~** *(what we stopped doing)* | ~~Label each facility “Strong ICU” / “Weak ICU”~~ | Fixed buckets are **opaque** (why this label?), **non-reproducible** (scores drift run-to-run), and **unsafe** for patient routing. Trust tiers belong in auditable SQL — not a model’s mood. |

---

## Layer cake (show this diagram)

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1 · SQL supervisor (dbt)                              │
│ evidence_strength_score · evidence_tier · citations         │
│ gold.facility_capability_assessments · capability_scored      │
└───────────────────────────┬─────────────────────────────────┘
                            │ frozen evidence_context
┌───────────────────────────▼─────────────────────────────────┐
│ Layer 1.5 · Document extraction                               │
│ READ_FILES → ai_parse_document v2.0 → ai_extract            │
│ bronze.nabh_certificate_extractions → dbt crosswalk           │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ Layer 2 · Narration only                                      │
│ ai_query (batch) or serving endpoint (pilot)                  │
│ → gold.capability_evidence_json + capability_evidence_md      │
│ → Lakebase → Trust Gauge citation panel                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ Layer 3 · Human supervisor                                    │
│ app.capability_overrides — Priya wins on conflict             │
└─────────────────────────────────────────────────────────────┘
```

---

## Before / After — the `ai_classify` pivot

| **Before (AI-default)** | **After (GIFT Gauge)** |
|-------------------------|------------------------|
| `ai_classify` → “Strong” / “Weak” labels loaded straight to gold | **dbt SQL** computes `evidence_strength_score` from supporting/contradicting counts, accreditation flags, match confidence |
| LLM both **decides** and **explains** — hallucinated tiers possible | LLM **only narrates** pre-computed context; dial number unchanged when you swap models |
| Unstructured model output hard to audit | **`ai_query` + `json_schema`** → typed JSON in `gold.capability_evidence_json` |
| PDF certificates parsed ad-hoc in Python scripts | **`ai_parse_document`** on UC volume — same Lakehouse SQL pipeline as everything else |

---

## Sound bites (pick two)

1. *“`ai_parse_document` turns accreditation PDFs into rows we can join — not paragraphs we have to trust.”*
2. *“`ai_query` writes the evidence card — it doesn’t write the score on the dial.”*
3. *“We dropped `ai_classify` because ‘Strong ICU’ from a model isn’t defensible in a district hearing — 0.87 from SQL is.”*
4. *“Structured JSON in gold, served through Lakebase — Agent Bricks as extractor and narrator, SQL as supervisor.”*

---

## Live pointers (if you have the repo open)

| Artifact | Path |
|----------|------|
| NABH PDF pipeline | `gift_india_api/src/verify_nabh_certificates.py` — `build_agent_bricks_parse_sql()` |
| Layer 2 narration | `gift_india_api/src/narrate_evidence.py` — `build_narration_sql()` |
| JSON schema + prompts | `gift_india_api/src/evidence_prompts.py` |
| SQL trust scores | `gift_india_dbt/models/gold/capability_scored.sql` |
| Gold tables | `gold.capability_evidence_json`, `gold.capability_evidence_md` |

---

## Timing in the ~3:00 demo

Insert **after** “How the trust dial works” and **before** “Built on Lakehouse” — or use as a dedicated Databricks judge / office-hours slide.

**In-app:** ✨ Demo walkthrough → step **“Agent Bricks — extract & narrate”**.
