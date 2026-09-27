"""Opt-in game/bout tournament policies, independent of any named sport.

The historical badminton_category_scoring table is only persistence. Existing
configuration and match snapshots override these defaults.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class GameTournamentPolicy:
    games_to_win: int = 2
    points_per_game: int = 21
    max_score: int | None = 30
    points_for_win: int = 3
    points_for_draw: int = 1
    points_for_loss: int = 0

    def validate_config(self, games_to_win: int, points_per_game: int) -> None:
        if not 1 <= games_to_win <= 5 or points_per_game < 1:
            raise ValueError("Invalid game scoring configuration")
        if self.max_score is not None and points_per_game > self.max_score:
            raise ValueError(f"Points per game must not exceed {self.max_score}")

    def normalize_games(self, games, games_to_win: int):
        if games is None:
            return None
        maximum = games_to_win * 2 - 1
        if len(games) > maximum:
            raise ValueError(f"A match can contain at most {maximum} games")
        numbers = [g.game_number for g in games]
        if any(n < 1 or n > maximum for n in numbers):
            raise ValueError(f"Game numbers must be between 1 and {maximum}")
        if len(set(numbers)) != len(numbers):
            raise ValueError("Game numbers must be unique")
        if self.max_score is not None and any(max(g.score_a, g.score_b) > self.max_score for g in games):
            raise ValueError(f"Game scores must not exceed {self.max_score}")
        return [dict(game_number=g.game_number, score_a=g.score_a, score_b=g.score_b)
                for g in sorted(games, key=lambda g: g.game_number)]

    def validate_score_winner(self, games, games_to_win: int, points_per_game: int, winner: str) -> None:
        """Validate a completed result using normalized games and match settings."""
        wins_a = wins_b = 0
        for game in games or []:
            score_a, score_b = game["score_a"], game["score_b"]
            if score_a == score_b or max(score_a, score_b) < points_per_game:
                raise ValueError("Completed matches require finished, untied game scores")
            wins_a += score_a > score_b
            wins_b += score_b > score_a
        calculated = "entry_a" if wins_a >= games_to_win else "entry_b" if wins_b >= games_to_win else None
        if calculated is None:
            raise ValueError(f"A side must win {games_to_win} games before completing the match")
        if winner != calculated:
            raise ValueError("Selected winner does not match the game scores")

    def bout_winner(self, bouts) -> str | None:
        wins_a = sum(b.winner == "player_a" for b in bouts)
        wins_b = sum(b.winner == "player_b" for b in bouts)
        return "entry_a" if wins_a > wins_b else "entry_b" if wins_b > wins_a else None

    def standings_points(self, winner, config=None) -> tuple[int, int]:
        rules = config or self
        if winner == "entry_a":
            return rules.points_for_win, rules.points_for_loss
        if winner == "entry_b":
            return rules.points_for_loss, rules.points_for_win
        return rules.points_for_draw, rules.points_for_draw

    def select_players(self, category, entry_a, entry_b, payload):
        """Validate and normalize per-match player selection for team categories.

        Returns (match_type, player_a_ids, player_b_ids). For non-team categories this
        is a no-op that returns (None, None, None), leaving existing behaviour intact.
        """
        if category.entry_type != "team":
            # Not a team category — ignore any player-selection input entirely.
            return None, None, None

        match_type = payload.match_type
        if match_type is None:
            # Team category but organizer scheduled a plain team-vs-team match without
            # picking players — allowed, keeps backward compatibility.
            if payload.player_a_participant_ids or payload.player_b_participant_ids:
                raise ValueError("Select a match type (singles or doubles) before choosing players")
            return None, None, None

        required = 1 if match_type == "singles" else 2
        a_ids = [str(pid) for pid in (payload.player_a_participant_ids or [])]
        b_ids = [str(pid) for pid in (payload.player_b_participant_ids or [])]
        if len(a_ids) != required or len(b_ids) != required:
            label = "1 player" if required == 1 else "2 players"
            raise ValueError(f"{match_type.capitalize()} matches require exactly {label} from each team")
        if len(set(a_ids)) != len(a_ids) or len(set(b_ids)) != len(b_ids):
            raise ValueError("A player cannot be selected twice in the same match")

        entry_a_member_ids = {str(rp.id) for rp in entry_a.participant_memberships}
        entry_b_member_ids = {str(rp.id) for rp in entry_b.participant_memberships}
        if not set(a_ids).issubset(entry_a_member_ids):
            raise ValueError("Selected players for team A must belong to team A")
        if not set(b_ids).issubset(entry_b_member_ids):
            raise ValueError("Selected players for team B must belong to team B")
        return match_type, a_ids, b_ids

    def validate_match(self, payload) -> None:
        if payload.status == "completed" and payload.winner is None:
            raise ValueError("Completed matches require an explicit winner")
        if payload.status != "completed" and payload.winner is not None:
            raise ValueError("Only completed matches may have a winner")
