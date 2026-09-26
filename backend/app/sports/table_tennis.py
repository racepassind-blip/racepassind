from .base import SportAdapter
from .tournament import GameTournamentPolicy

# Independent configuration: does not import Badminton or its defaults.
adapter = SportAdapter(
    key="table_tennis", distance_required=False, supports_distance=False,
    supports_tournament=True, result_type="match_score", number_label="Player ID",
    tournament=GameTournamentPolicy(games_to_win=2, points_per_game=11, max_score=None),
)
