from typing import Any

from .base import SportAdapter
from .tournament import GameTournamentPolicy


class BadmintonAdapter(SportAdapter):
    def normalize_event_config(self, config: dict[str, Any] | None) -> dict[str, Any]:
        tournament_format = (config or {}).get("tournament_format", "knockout")
        if tournament_format not in {"league", "knockout"}:
            raise ValueError("Unsupported badminton tournament format")
        return {"tournament_format": tournament_format}


adapter = BadmintonAdapter(
    key="badminton", distance_required=False, supports_distance=False,
    supports_tournament=True, result_type="match_score",
    number_label="Jersey Number", number_scope="team_member",
    tournament=GameTournamentPolicy(games_to_win=2, points_per_game=21, max_score=30),
)
