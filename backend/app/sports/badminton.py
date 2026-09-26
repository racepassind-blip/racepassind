from .base import SportAdapter
from .tournament import GameTournamentPolicy

adapter = SportAdapter(
    key="badminton", distance_required=False, supports_distance=False,
    supports_tournament=True, result_type="match_score",
    number_label="Jersey Number", number_scope="team_member",
    tournament=GameTournamentPolicy(games_to_win=2, points_per_game=21, max_score=30),
)
