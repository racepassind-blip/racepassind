from .base import SportAdapter


class TrekkingAdapter(SportAdapter):
    """Trekking events use one shared route and one entry category."""


# Canonical sport/event type is "trekking". The route is event-level; categories
# cannot define different distances. Tournament and race-result functionality
# remain disabled.
adapter = TrekkingAdapter(
    key="trekking",
    distance_required=False,
    supports_distance=False,
    supports_tournament=False,
    team_tournament=False,
    supports_pickup_points=True,
    result_type="none",
)
