from .base import SportAdapter


class TrekkingAdapter(SportAdapter):
    """Trekking event policy.

    Treks keep the generic distance/category and seat/payment behavior but never
    expose tournament or race-result tooling. This adapter adds no sport-specific
    capabilities beyond the shared defaults.
    """


# Canonical sport/event type is "trekking". Distance is supported; tournaments
# (including team tournaments) and race-time results are explicitly disabled so
# no badminton or race-result functionality is reachable for a trek.
adapter = TrekkingAdapter(
    key="trekking",
    supports_distance=True,
    supports_tournament=False,
    team_tournament=False,
    supports_pickup_points=True,
    result_type="none",
)
