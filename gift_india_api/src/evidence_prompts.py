"""Shared prompts and JSON schema for capability evidence narration.

Used by ``narrate_evidence`` (Databricks ``ai_query`` and direct serving-endpoint
calls). The deterministic score lives in ``gold.capability_scored``; these prompts
only narrate the pre-computed evidence context.
"""
from __future__ import annotations

import json

DEFAULT_ENDPOINT = "open_navigator_evidence_agent"

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


def json_prompt(evidence_context: str) -> str:
    return (
        "You are a verification assistant for a hospital capability registry. "
        "A care planner is checking whether a facility truly offers a given clinical "
        "capability. Use the numbers EXACTLY as provided — do not recompute or invent "
        "any value or source.\n\n"
        f"{evidence_context}\n\n"
        "TASK\n"
        "1. Map evidence_tier to verdict: Strong→Confirmed, Moderate→Likely, "
        "Weak→Needs review, Insufficient→Unsupported. Never exceed \"Needs review\" "
        "when contradicting > 0 or trust_signal = weak_suspicious.\n"
        "2. Specialty corroboration: state whether the on-record specialties plausibly "
        "support this capability (e.g. gynecologyAndObstetrics + neonatology → "
        "maternity; emergencyMedicine + criticalCareMedicine → emergency/ICU).\n"
        "3. Write a 1–2 sentence plain-language rationale a non-clinical planner can act on.\n"
        "4. List citations drawn ONLY from the evidence above (best source, "
        "supporting/contradicting counts, specialties).\n"
        "5. Recommend human review and give a reason; force true when "
        "trust_signal = weak_suspicious or contradicting > 0.\n\n"
        "Return ONLY JSON matching the schema. No prose, no markdown."
    )


def markdown_prompt(evidence_context: str, facility_name: str, capability_label: str) -> str:
    return (
        "You are a verification assistant for a hospital capability registry. "
        "Use the numbers EXACTLY as provided — never invent sources or values.\n\n"
        f"{evidence_context}\n\n"
        "TASK\n"
        "Produce a compact Markdown evidence card the planner sees when expanding "
        "this facility. Use exactly this structure:\n\n"
        f"### {facility_name} — {capability_label}\n"
        "**Verdict:** <Confirmed | Likely | Needs review | Unsupported>  ·  "
        "**Evidence:** {evidence_tier} ({evidence_strength_score})\n\n"
        "<one-sentence plain-language verdict>\n\n"
        "**Why:**\n"
        "- <supporting point from the evidence>\n"
        "- <specialty corroboration point>\n"
        "- <contradiction or gap, if any>\n\n"
        "**Citations:**\n"
        "- {best_source} — <what it supports>\n"
        "- {supporting_count} supporting / {contradicting_count} contradicting items\n"
        "- Specialties on record: <only the relevant ones>\n\n"
        "**Review:** <✅ Looks solid | ⚠️ Needs human review> — <reason>\n\n"
        "Rules: evidence only, no invented sources/numbers, under 120 words, "
        "and never rate above \"Needs review\" when contradicting > 0 or "
        "trust_signal = weak_suspicious."
    )
