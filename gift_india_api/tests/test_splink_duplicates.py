"""Tests for Splink duplicate detection helpers."""
from __future__ import annotations

import pandas as pd

from src.splink_duplicates import _deterministic_pairs, _merge_predictions, build_merge_candidates


def test_deterministic_pairs_finds_similar_virtue_rows():
    df = pd.DataFrame(
        [
            {
                "unique_id": "virtue|a1",
                "record_id": "a1",
                "name": "Apollo Hospital Chennai",
                "state": "Tamil Nadu",
                "district": "Chennai",
                "lat": 13.0,
                "lon": 80.2,
                "match_confidence": 0.9,
                "source": "virtue",
                "match_name": "apollo chennai",
                "brand_key": "apollo chennai",
            },
            {
                "unique_id": "virtue|a2",
                "record_id": "a2",
                "name": "Apollo Hospitals Chennai",
                "state": "Tamil Nadu",
                "district": "Chennai",
                "lat": 13.01,
                "lon": 80.21,
                "match_confidence": 0.85,
                "source": "virtue",
                "match_name": "apollo chennai",
                "brand_key": "apollo chennai",
            },
        ]
    )
    pairs = _deterministic_pairs(df)
    assert not pairs.empty
    assert pairs.iloc[0]["match_probability"] >= 0.55


def test_merge_predictions_deduplicates_pair_keys():
    a = pd.DataFrame([{"unique_id_l": "virtue|1", "unique_id_r": "virtue|2", "match_probability": 0.9}])
    b = pd.DataFrame([{"unique_id_l": "virtue|2", "unique_id_r": "virtue|1", "match_probability": 0.8}])
    merged = _merge_predictions(a, b)
    assert len(merged) == 1
    assert merged.iloc[0]["match_probability"] == 0.9


def test_build_merge_candidates_empty_input():
    out = build_merge_candidates(pd.DataFrame())
    assert out.empty
