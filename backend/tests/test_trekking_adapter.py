"""Focused tests for the dedicated Trekking sport adapter.

These intentionally depend only on ``app.sports.*`` so they exercise the
adapter registry in isolation, without pulling in the HTTP/DB layers.
"""
import pytest

from app.sports.base import SportAdapter
from app.sports.registry import get_adapter
from app.sports.trekking import TrekkingAdapter


def test_get_adapter_trekking_returns_dedicated_adapter():
    adapter = get_adapter("trekking")
    assert isinstance(adapter, TrekkingAdapter)
    assert adapter.key == "trekking"
    # Trekking is its own adapter, not the shared generic fallback.
    assert adapter is not get_adapter(None)


def test_get_adapter_trekking_is_case_insensitive():
    trekking = get_adapter("trekking")
    assert get_adapter("TREKKING") is trekking
    assert get_adapter(" Trekking ") is trekking


def test_trekking_adapter_capabilities():
    adapter = get_adapter("trekking")
    assert adapter.supports_distance is True
    assert adapter.supports_tournament is False
    assert adapter.team_tournament is False
    assert adapter.result_type == "none"
    # Trekking must never reach tournament or race-result tooling.
    assert adapter.tournament_capable(has_team=True) is False
    with pytest.raises(ValueError):
        adapter.race_metrics(300, 1000)


def test_legacy_hiking_events_keep_trekking_capabilities():
    assert get_adapter("hiking") is get_adapter("trekking")
    assert get_adapter("hiking").key == "trekking"


def test_running_cycling_badminton_adapters_unchanged():
    running = get_adapter("running")
    cycling = get_adapter("cycling")
    assert running.result_type == "race_time"
    assert cycling.result_type == "race_time"
    assert running.race_metrics(300, 1000) == (300, None)
    assert cycling.race_metrics(360, 1000) == (None, 1000)

    badminton = get_adapter("badminton")
    assert badminton.supports_tournament is True
    assert badminton.result_type == "match_score"
    # Trekking does not share badminton behavior.
    assert get_adapter("trekking") is not badminton


def test_unknown_legacy_sport_fallback_still_works():
    fallback = get_adapter("some_unknown_legacy_sport")
    assert isinstance(fallback, SportAdapter)
    assert fallback.key == "legacy"
    assert fallback.result_type == "none"
    # Legacy badminton-style free-form labels keep their allocation behavior.
    assert get_adapter("mixed badminton social").number_label == "Jersey Number"
