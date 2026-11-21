"""Tests for Splink bulk auto-approve."""
from __future__ import annotations

from src.auto_approve_splink import _recommendation_filter


def test_recommendation_filter_default():
    sql, params = _recommendation_filter(False)
    assert "merge" in params and "link" in params
    assert "IN" in sql


def test_recommendation_filter_all():
    sql, params = _recommendation_filter(True)
    assert params == ["distinct"]
    assert "!=" in sql
