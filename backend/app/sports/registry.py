"""The only module importing named sports. Unknown legacy events remain readable."""
from dataclasses import replace

from .base import SportAdapter
from .badminton import adapter as badminton
from .table_tennis import adapter as table_tennis
from .running import adapter as running
from .cycling import adapter as cycling
from .trekking import adapter as trekking
from .tournament import GameTournamentPolicy


def normalize_sport(sport: str | None) -> str:
    return (sport or "").strip().lower().replace("-", "_").replace(" ", "_")


class SportAdapterRegistry:
    def __init__(self):
        self._adapters: dict[str, SportAdapter] = {}
        self.fallback = SportAdapter(key="legacy", tournament=GameTournamentPolicy())

    def register(self, adapter: SportAdapter, *aliases: str) -> None:
        keys = [normalize_sport(key) for key in (adapter.key, *aliases)]
        if any(key in self._adapters for key in keys):
            raise ValueError("Sport adapter already registered")
        for key in keys:
            self._adapters[key] = adapter

    def get_adapter(self, sport: str | None) -> SportAdapter:
        key = normalize_sport(sport)
        if key in self._adapters:
            return self._adapters[key]
        # Compatibility for old free-form allocation labels, not sport dispatch.
        if "badminton" in key or "squash" in key:
            return replace(self.fallback, number_label="Jersey Number", number_scope="team_member")
        return self.fallback


registry = SportAdapterRegistry()
for adapter in (badminton, table_tennis, running, cycling):
    registry.register(adapter)
registry.register(trekking, "trekking")
# Existing generic game-scoring behavior is retained for tennis/squash.
registry.register(SportAdapter(key="tennis", distance_required=False, supports_distance=False,
    supports_tournament=True, result_type="match_score", number_label="Player ID",
    tournament=GameTournamentPolicy()))
registry.register(SportAdapter(key="squash", distance_required=False, supports_distance=False,
    supports_tournament=True, result_type="match_score", number_label="Jersey Number",
    number_scope="team_member", tournament=GameTournamentPolicy()))
for key in ("triathlon", "swimming", "obstacle_course", "walkathon"):
    registry.register(SportAdapter(key=key, tournament=GameTournamentPolicy()))


def get_adapter(sport: str | None) -> SportAdapter:
    return registry.get_adapter(sport)
