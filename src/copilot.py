"""Navigator copilot — parse a plain-language team description into a TeamRequest.

This is a lightweight, dependency-free rules parser so the demo works offline.
Swap `parse_request` for an LLM call to make it conversational; the downstream
matching engine is unchanged.
"""
from __future__ import annotations

import re

from .matching import TeamRequest

# Keyword -> canonical specialty (from src.data.SPECIALTIES).
SPECIALTY_KEYWORDS = {
    "Cataract / Ophthalmology": [
        "cataract", "ophthal" , "eye", "vision", "ophthalmology", "glaucoma",
    ],
    "General Surgery": ["general surg", "hernia", "appendix", "gallbladder", "general"],
    "Obstetrics & Gynaecology": [
        "obstet", "gynae", "gynec", "ob/gyn", "obgyn", "maternal", "c-section",
        "cesarean", "fistula",
    ],
    "Orthopaedics": ["ortho", "bone", "joint", "knee", "hip", "fracture", "spine"],
    "Cleft & Plastic": ["cleft", "lip", "palate", "plastic", "reconstruct"],
    "ENT": ["ent", "ear", "nose", "throat", "tonsil", "hearing"],
    "Paediatric Surgery": ["paediatric", "pediatric", "child", "neonat", "infant"],
    "Cardiac": ["cardiac", "heart", "cardio", "valve"],
    "Urology": ["urolog", "kidney", "bladder", "prostate", "stone"],
    "Burns & Reconstruction": ["burn", "scald", "contracture"],
}


def _detect_specialty(text: str) -> str | None:
    t = text.lower()
    best = None
    for spec, kws in SPECIALTY_KEYWORDS.items():
        for kw in kws:
            if kw in t:
                return spec
    return best


def _detect_int(patterns: list[str], text: str, default: int) -> int:
    for pat in patterns:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            try:
                return int(m.group(1))
            except (ValueError, IndexError):
                continue
    return default


def parse_request(text: str) -> tuple[TeamRequest | None, str]:
    """Return (request, clarification_message).

    If the specialty can't be determined, request is None and the message asks
    the user to clarify.
    """
    specialty = _detect_specialty(text)
    if specialty is None:
        return None, (
            "I couldn't tell which surgical specialty your team covers. "
            "Try something like: _\"3-surgeon cataract team for 5 days, rural ok\"_."
        )

    team_size = _detect_int(
        [
            r"(\d+)\s*[-\s]?(?:surgeon|surgeons|person|people|member|doctor|docs?)",
            r"team of\s*(\d+)",
        ],
        text,
        default=3,
    )
    days = _detect_int(
        [r"(\d+)\s*[-\s]?(?:day|days)", r"for\s*(\d+)\s*d"],
        text,
        default=5,
    )

    t = text.lower()
    rural_ok = True
    if any(p in t for p in ["urban only", "city only", "no rural", "not rural"]):
        rural_ok = False
    elif any(p in t for p in ["rural", "remote", "village", "hard to reach", "desert"]):
        rural_ok = True

    req = TeamRequest(
        specialty=specialty,
        team_size=max(1, team_size),
        days=max(1, days),
        rural_ok=rural_ok,
    )
    summary = (
        f"Got it — a **{req.team_size}-person {specialty}** team for **{req.days} days**"
        f"{' (open to rural / remote sites)' if rural_ok else ' (urban sites only)'}. "
        f"Capacity ≈ **{req.capacity:,} procedures**. Here are the best placements:"
    )
    return req, summary
