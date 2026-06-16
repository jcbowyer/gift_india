"""Shared prompts and JSON schema for capability evidence narration.

Used by ``narrate_evidence`` (Databricks ``ai_query`` and direct serving-endpoint
calls). The deterministic score lives in ``gold.capability_scored``; these prompts
only narrate the pre-computed evidence context.
"""
from __future__ import annotations

import json
import os

DEFAULT_ENDPOINT = os.getenv(
    "EVIDENCE_AGENT_ENDPOINT", "databricks-gpt-oss-20b"
)

# Layer 1 scoring rubric — mirrors gift_india_dbt/models/gold/capability_scored.sql.
# Narrators must explain grades using this text; they must NOT recompute scores.
EVIDENCE_GRADING_RUBRIC = """\
EVIDENCE GRADING RUBRIC (pre-computed in SQL — explain using these rules; do not recalculate)

How evidence_strength_score is built (only when claimed = true):
- 45% supporting ratio: supporting_count / (supporting_count + contradicting_count)
- 25% evidence breadth: min(evidence_count, 5) / 5
- 30% facility name/website match confidence (facility_confidence)
- Each contradicting item multiplies the total by 0.8 (strong penalty)
- Unclaimed capabilities score 0.0

Tier thresholds (evidence_tier from score):
- Strong: score >= 0.85 — multiple corroborating sources, high facility match, little or no contradiction
- Moderate: 0.65–0.84 — solid but not overwhelming evidence; may have minor gaps
- Weak: 0.45–0.64 — thin or mixed evidence; planner should treat as tentative
- Insufficient: score < 0.45 — little or no supporting evidence

Verdict mapping (planner-facing label):
- Strong → Confirmed | Moderate → Likely | Weak → Needs review | Insufficient → Unsupported

Overrides (cap verdict at "Needs review" even when tier is Strong/Moderate):
- contradicting_count > 0, OR trust_signal = weak_suspicious

What typically moves a facility to another tier (directional — do not invent numbers):
- Up toward Strong: more supporting items (especially diverse sources), higher facility_confidence, zero contradicting items
- Down toward Insufficient: more contradicting items, fewer evidence items, low facility_confidence, or unclaimed capability
"""

JSON_TASK = """\
TASK
1. Map evidence_tier to verdict using the rubric above. Apply override caps when contradicting > 0 or trust_signal = weak_suspicious.
2. In rationale, include: (a) why THIS facility's tier fits in plain language, and (b) one short sentence on what evidence pattern would move it to the next tier up or down.
3. Specialty corroboration: state whether on-record specialties plausibly support this capability.
4. List citations drawn ONLY from the evidence above (best source, supporting/contradicting counts, specialties).
5. Recommend human review and give a reason; force review_recommended=true when trust_signal = weak_suspicious or contradicting > 0.

Return ONLY JSON matching the schema. No prose, no markdown."""

MARKDOWN_TASK = """\
TASK
Produce a compact Markdown evidence card the planner sees when expanding this facility. Use exactly this structure:

### <facility_name> — <capability_label>
**Verdict:** <Confirmed | Likely | Needs review | Unsupported>  ·  **Evidence:** <evidence_tier> (<evidence_strength_score>)

<one-sentence plain-language verdict>

**Grade:** <2–3 sentences: why this facility is in the assigned evidence_tier, referencing the score and the main drivers (supporting ratio, evidence breadth, facility confidence, contradicting penalty). Mention the verdict mapping from the rubric.>

**What would change this grade:**
- <one bullet: what evidence would typically move this facility one tier up>
- <one bullet: what would move it one tier down or keep it capped at Needs review, if applicable>

**Why:**
- <supporting point from the evidence>
- <specialty corroboration point>
- <contradiction or gap, if any>

**Citations:**
- <best_source> — <what it supports>
- <supporting_count> supporting / <contradicting_count> contradicting items
- Specialties on record: <only the relevant ones>

**Review:** <✅ Looks solid | ⚠️ Needs human review> — <reason>

Rules: evidence only, no invented sources/numbers, under 200 words, never rate above "Needs review" when contradicting > 0 or trust_signal = weak_suspicious."""

JSON_RESPONSE_FORMAT = json.dumps(
    {
        "type": "json_schema",
        "json_schema": {
            "name": "capability_evidence_assessment",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "facility_id": {"type": "string"},
                    "capability": {"type": "string"},
                    "verdict": {
                        "type": "string",
                        "enum": ["Confirmed", "Likely", "Needs review", "Unsupported"],
                    },
                    "evidence_tier": {
                        "type": "string",
                        "enum": ["Strong", "Moderate", "Weak", "Insufficient"],
                    },
                    "evidence_strength_score": {"type": "number"},
                    "rationale": {"type": "string"},
                    "specialty_corroboration": {"type": "string"},
                    "citations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source": {"type": "string"},
                                "stance": {
                                    "type": "string",
                                    "enum": ["supporting", "contradicting", "contextual"],
                                },
                                "detail": {"type": "string"},
                            },
                            "required": ["source", "stance", "detail"],
                        },
                    },
                    "review_recommended": {"type": "boolean"},
                    "review_reason": {"type": "string"},
                },
                "required": [
                    "facility_id",
                    "capability",
                    "verdict",
                    "evidence_tier",
                    "evidence_strength_score",
                    "rationale",
                    "citations",
                    "review_recommended",
                ],
            },
        },
    }
)


def _prompt_intro(*, json_mode: bool) -> str:
    role = (
        "A care planner is checking whether a facility truly offers a given clinical "
        "capability. "
        if json_mode
        else ""
    )
    return (
        "You are a verification assistant for a hospital capability registry. "
        f"{role}"
        "Use the numbers EXACTLY as provided — do not recompute or invent any value "
        "or source.\n\n"
    )


def json_prompt(evidence_context: str) -> str:
    return (
        f"{_prompt_intro(json_mode=True)}"
        f"{evidence_context}\n\n"
        f"{EVIDENCE_GRADING_RUBRIC}\n\n"
        f"{JSON_TASK}"
    )


def markdown_prompt(evidence_context: str, facility_name: str, capability_label: str) -> str:
    header = f"### {facility_name} — {capability_label}"
    task = MARKDOWN_TASK.replace(
        "### <facility_name> — <capability_label>",
        header,
        1,
    )
    return (
        f"{_prompt_intro(json_mode=False)}"
        f"{evidence_context}\n\n"
        f"{EVIDENCE_GRADING_RUBRIC}\n\n"
        f"{task}"
    )


def stub_grade_sections(
    *,
    tier: str,
    score: float,
    supporting: int,
    contradicting: int,
    trust: str,
) -> tuple[str, str]:
    """Deterministic Grade + What would change blocks for stub narrations."""
    verdict_map = {
        "Strong": "Confirmed",
        "Moderate": "Likely",
        "Weak": "Needs review",
        "Insufficient": "Unsupported",
    }
    verdict = verdict_map.get(tier, "Needs review")
    capped = contradicting > 0 or trust == "weak_suspicious"
    grade = (
        f"This facility is **{tier}** (score {score:.3f}), mapped to **{verdict}**. "
        f"Tiers use score bands: Strong ≥0.85, Moderate 0.65–0.84, Weak 0.45–0.64, "
        f"Insufficient <0.45. The score blends supporting ratio (45%), evidence breadth "
        f"(25%), facility match confidence (30%), with a 0.8× penalty per contradicting item."
    )
    if capped:
        grade += (
            " Verdict is capped at Needs review because "
            + (
                f"there are {contradicting} contradicting item(s)."
                if contradicting > 0
                else "trust_signal is weak_suspicious."
            )
        )

    up_hints = {
        "Insufficient": "Add supporting pipeline items and improve facility name/website match to reach Weak (≥0.45).",
        "Weak": "Add more supporting sources and raise facility confidence to reach Moderate (≥0.65).",
        "Moderate": "Add diverse corroborating evidence with no contradictions to reach Strong (≥0.85).",
        "Strong": "Already at Strong; keep contradicting items at zero to avoid review caps.",
    }
    down_hint = (
        "More contradicting items or thinner evidence would lower the score toward Insufficient."
        if tier != "Insufficient"
        else "Without new supporting evidence or a stronger facility match, this stays Insufficient."
    )
    change = (
        f"- **Up:** {up_hints.get(tier, up_hints['Weak'])}\n"
        f"- **Down / cap:** {down_hint}"
    )
    if capped and tier in ("Strong", "Moderate"):
        change += "\n- **Cap:** Contradictions or weak_suspicious trust keep the planner verdict at Needs review."
    return grade, change


def escape_for_sql_concat(text: str) -> str:
    """Escape a prompt fragment embedded in a Databricks SQL CONCAT literal."""
    return text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
