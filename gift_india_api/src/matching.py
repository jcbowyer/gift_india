"""Recommendation engine for Governance, Integrity, & Facility Trust Desk.

Given a surgical-team request (specialty, capacity, willingness to travel rural),
rank Indian districts by how much a deployment there would help — combining
unmet surgical need, the specialty-specific capacity gap, and accessibility.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# Rough surgical procedures needed per 100k population per year, by specialty.
# Used to translate population into an estimate of annual need.
NEED_PER_100K = {
    "Cataract / Ophthalmology": 900,
    "General Surgery": 1100,
    "Obstetrics & Gynaecology": 1500,
    "Orthopaedics": 700,
    "Cleft & Plastic": 40,
    "ENT": 350,
    "Paediatric Surgery": 120,
    "Cardiac": 150,
    "Urology": 250,
    "Burns & Reconstruction": 90,
}
DEFAULT_NEED_PER_100K = 500


@dataclass
class TeamRequest:
    specialty: str
    team_size: int = 3
    days: int = 5
    rural_ok: bool = True
    # Procedures per surgeon-day a team can realistically perform for this specialty.
    procedures_per_surgeon_day: int = 8

    @property
    def capacity(self) -> int:
        return int(self.team_size * self.days * self.procedures_per_surgeon_day)


@dataclass
class Recommendation:
    district: str
    state: str
    lat: float
    lon: float
    population: int
    urbanity: float
    estimated_annual_need: int
    existing_capacity: int
    unmet_need: int
    accessibility_penalty: float
    score: float
    team_impact: int
    rationale: str = ""


@dataclass
class EngineResult:
    recommendations: list[Recommendation]
    district_table: pd.DataFrame = field(repr=False)


def _capacity_by_district(facilities: pd.DataFrame, specialty: str) -> pd.Series:
    """Sum annual_surgeries for facilities offering `specialty`, weighted by
    confidence, grouped by district."""
    mask = facilities["specialties"].fillna("").str.contains(
        specialty, regex=False
    ) & facilities["offers_surgery"]
    sub = facilities[mask].copy()
    if sub.empty:
        return pd.Series(dtype=float)
    # Assume a facility splits its surgical volume across the specialties it offers.
    n_spec = (
        sub["specialties"].str.count(r"\|").fillna(0).astype(int) + 1
    ).clip(lower=1)
    sub["spec_volume"] = (
        sub["annual_surgeries"] / n_spec * sub["match_confidence"]
    )
    return sub.groupby("district")["spec_volume"].sum()


def rank_districts(
    bundle, request: TeamRequest, top_n: int = 8
) -> EngineResult:
    districts = bundle.districts.copy()
    cap = _capacity_by_district(bundle.facilities, request.specialty)

    need_rate = NEED_PER_100K.get(request.specialty, DEFAULT_NEED_PER_100K)
    districts["estimated_annual_need"] = (
        districts["population"] / 100_000 * need_rate
    ).round().astype(int)
    districts["existing_capacity"] = (
        districts["district"].map(cap).fillna(0).round().astype(int)
    )
    districts["unmet_need"] = (
        (districts["estimated_annual_need"] - districts["existing_capacity"])
        .clip(lower=0)
        .astype(int)
    )

    # Coverage ratio: how much of the need is already met (lower = bigger desert).
    coverage = districts["existing_capacity"] / districts[
        "estimated_annual_need"
    ].replace(0, np.nan)
    districts["coverage_ratio"] = coverage.fillna(0).clip(0, 2)

    # Deprivation severity — the core "medical desert" signal. 1.0 = no coverage.
    deprivation = (1 - districts["coverage_ratio"]).clip(0, 1)

    # Reach — reward helping more people, but log-scaled so megacities don't
    # automatically dominate genuinely underserved smaller districts.
    log_pop = np.log10(districts["population"].clip(lower=1))
    reach = (log_pop - log_pop.min()) / max(log_pop.max() - log_pop.min(), 1e-9)

    # Accessibility: deserts are mostly rural, so only lightly discount remoteness
    # when the team is willing to travel; heavily penalize it when they are not.
    if request.rural_ok:
        districts["accessibility_penalty"] = (1 - districts["urbanity"]) * 0.08
    else:
        districts["accessibility_penalty"] = (1 - districts["urbanity"]) * 0.95

    districts["score"] = (
        0.65 * deprivation
        + 0.35 * reach
    ) * (1 - districts["accessibility_penalty"])

    # A district that already meets its demand is not a placement candidate.
    districts.loc[districts["unmet_need"] <= 0, "score"] = 0.0

    # How many people this single deployment realistically serves.
    districts["team_impact"] = np.minimum(
        request.capacity, districts["unmet_need"]
    ).astype(int)

    ranked = districts.sort_values("score", ascending=False).head(top_n)

    recs: list[Recommendation] = []
    for _, r in ranked.iterrows():
        rec = Recommendation(
            district=r["district"],
            state=r["state"],
            lat=float(r["lat"]),
            lon=float(r["lon"]),
            population=int(r["population"]),
            urbanity=float(r["urbanity"]),
            estimated_annual_need=int(r["estimated_annual_need"]),
            existing_capacity=int(r["existing_capacity"]),
            unmet_need=int(r["unmet_need"]),
            accessibility_penalty=float(r["accessibility_penalty"]),
            score=float(r["score"]),
            team_impact=int(r["team_impact"]),
        )
        rec.rationale = _rationale(rec, request)
        recs.append(rec)

    return EngineResult(recommendations=recs, district_table=districts)


def _rationale(rec: Recommendation, request: TeamRequest) -> str:
    coverage = (
        rec.existing_capacity / rec.estimated_annual_need
        if rec.estimated_annual_need
        else 0
    )
    setting = "rural / hard-to-reach" if rec.urbanity < 0.2 else (
        "semi-urban" if rec.urbanity < 0.6 else "urban"
    )
    return (
        f"{rec.district}, {rec.state} ({setting}) has an estimated "
        f"{rec.unmet_need:,} unmet {request.specialty} procedures/year — only "
        f"{coverage:.0%} of demand is currently covered. A {request.team_size}-person "
        f"team over {request.days} days could clear ~{rec.team_impact:,} cases."
    )
