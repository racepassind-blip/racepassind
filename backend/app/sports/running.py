from .base import SportAdapter


def calc_pace_seconds_per_km(total_seconds: float, distance_metres: float) -> int | None:
    if distance_metres <= 0 or total_seconds <= 0:
        return None
    return round(total_seconds / (distance_metres / 1000.0))


def format_pace(value: int | None) -> str | None:
    if value is None:
        return None
    minutes, seconds = divmod(value, 60)
    return f"{minutes}:{seconds:02d} /km"


class RunningAdapter(SportAdapter):
    def race_metrics(self, seconds, metres):
        return calc_pace_seconds_per_km(seconds, metres), None

    def race_display(self, pace, speed):
        return format_pace(pace), None


adapter = RunningAdapter(key="running", result_type="race_time")
