"""Sport policy contract. No ORM, HTTP, payment or other sport dependencies."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from .tournament import GameTournamentPolicy
from typing import Literal


@dataclass(frozen=True)
class SportAdapter:
    key: str
    distance_required: bool = True
    supports_distance: bool = True
    supports_tournament: bool = False
    team_tournament: bool = True  # Preserve legacy team-format events.
    result_type: Literal["none", "match_score", "race_time"] = "none"
    number_label: str = "Bib Number"
    number_scope: str = "individual"
    tournament: GameTournamentPolicy = field(default_factory=GameTournamentPolicy)

    def normalize_event_config(self, config: dict[str, Any] | None) -> dict[str, Any]:
        """Validate sport-specific event setup without coupling generic APIs to a sport."""
        return {}

    def category_distance(self, value: str | None) -> str | None:
        distance = value.strip() if value else None
        if self.distance_required and not distance:
            raise ValueError("Distance is required for this sport")
        return distance if self.supports_distance else None

    def tournament_capable(self, has_team: bool = False) -> bool:
        return self.supports_tournament or (self.team_tournament and has_team)

    def validate_registration(self, category, count: int) -> None:
        """Category cardinality is a reusable rule; sports may override it."""
        minimum, maximum = self.registration_bounds(category)
        if not minimum <= count <= maximum:
            label = category.name if category else "This"
            if minimum == maximum:
                raise ValueError(f"{label} entry requires exactly {minimum} participants")
            raise ValueError(f"{label} entry requires between {minimum} and {maximum} participants")

    def registration_bounds(self, category) -> tuple[int, int]:
        minimum = category.participants_per_entry if category else 1
        maximum = category.team_size_max if category and category.entry_type == "team" else None
        return minimum, maximum if maximum is not None else minimum

    def race_metrics(self, seconds: float, metres: float) -> tuple[int | None, int | None]:
        raise ValueError("Race-time results are not supported for this sport")

    def race_display(self, pace: int | None, speed: int | None) -> tuple[str | None, str | None]:
        raise ValueError("Race-time results are not supported for this sport")
