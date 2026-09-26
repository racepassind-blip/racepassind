from .base import SportAdapter


def calc_speed_kmh_x100(total_seconds: float, distance_metres: float) -> int | None:
    if distance_metres <= 0 or total_seconds <= 0:
        return None
    return round((distance_metres / 1000.0) / (total_seconds / 3600.0) * 100)


def format_speed(value: int | None) -> str | None:
    return None if value is None else f"{value / 100:.2f} km/h"


class CyclingAdapter(SportAdapter):
    def race_metrics(self, seconds, metres):
        return None, calc_speed_kmh_x100(seconds, metres)

    def race_display(self, pace, speed):
        return None, format_speed(speed)


adapter = CyclingAdapter(key="cycling", result_type="race_time")
