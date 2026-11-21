"""Tests for Splink merge review → facility cluster application."""
from __future__ import annotations

from src.apply_merge_reviews import _pick_master_id, build_facility_clusters


def test_singleton_cluster_uses_virtue_id():
    clusters = build_facility_clusters(
        unique_ids=["virtue|VF-1"],
        edges=[],
        virtue_confidence={"VF-1": 0.95},
    )
    assert len(clusters) == 1
    assert clusters[0]["master_facility_id"] == "VF-1"
    assert clusters[0]["cluster_method"] == "singleton"


def test_approved_merge_collapses_cross_source_cluster():
    clusters = build_facility_clusters(
        unique_ids=["virtue|VF-1", "nabh|N-9"],
        edges=[("virtue|VF-1", "nabh|N-9")],
        virtue_confidence={"VF-1": 0.88},
    )
    by_source = {(c["source_system"], c["source_id"]): c for c in clusters}
    assert by_source[("virtue", "VF-1")]["master_facility_id"] == "VF-1"
    assert by_source[("nabh", "N-9")]["master_facility_id"] == "VF-1"
    assert by_source[("virtue", "VF-1")]["cluster_method"] == "splink_approved"
    assert by_source[("virtue", "VF-1")]["member_count"] == 2


def test_pick_master_without_virtue_uses_stable_hash():
    master = _pick_master_id(
        [("jci", "J1"), ("nabh", "N2")],
        {},
    )
    assert master.startswith("MF-")
    assert len(master) == 15
