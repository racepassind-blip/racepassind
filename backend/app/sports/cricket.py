"""Cricket event setup policy."""
from __future__ import annotations

from typing import Any

from .base import SportAdapter
from .tournament import GameTournamentPolicy


class CricketAdapter(SportAdapter):
    def normalize_event_config(self, config: dict[str, Any] | None) -> dict[str, Any]:
        raw = config or {}
        tournament_format = raw.get("tournament_format", "league")
        ball_type = raw.get("ball_type", "tennis")
        if tournament_format not in {"league", "knockout", "league_knockout"}:
            raise ValueError("Unsupported cricket tournament format")
        if ball_type not in {"tennis", "leather", "other"}:
            raise ValueError("Unsupported cricket ball type")
        try:
            overs = int(raw.get("overs_per_innings", 10))
            minimum = int(raw.get("minimum_players", 11))
            maximum = int(raw.get("maximum_players", 15))
        except (TypeError, ValueError) as exc:
            raise ValueError("Cricket setup values must be integers") from exc
        if overs <= 0:
            raise ValueError("overs_per_innings must be greater than zero")
        if minimum <= 0:
            raise ValueError("minimum_players must be greater than zero")
        if maximum < minimum:
            raise ValueError("maximum_players must be greater than or equal to minimum_players")
        return {
            "tournament_format": tournament_format,
            "ball_type": ball_type,
            "overs_per_innings": overs,
            "minimum_players": minimum,
            "maximum_players": maximum,
        }


adapter = CricketAdapter(
    key="cricket",
    distance_required=False,
    supports_distance=False,
    supports_tournament=True,
    team_tournament=True,
    result_type="none",
    number_label="Player ID",
    number_scope="team_member",
    tournament=GameTournamentPolicy(),
)
