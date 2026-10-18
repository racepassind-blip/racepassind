from .base import SportAdapter


class MotorcycleAdapter(SportAdapter):
    """Motorcycle events use rider categories and operational check-in only."""


# Motorcycle V1 intentionally does not enable bib allocation, tournament, or
# competitive result tooling. Meeting points reuse the existing pickup-point
# storage and registration pipeline.
adapter = MotorcycleAdapter(
    key="motorcycle",
    distance_required=False,
    supports_distance=True,
    supports_tournament=False,
    team_tournament=False,
    supports_pickup_points=True,
    result_type="none",
    number_label="Ride Number",
    number_enabled=False,
    pickup_point_label="Meeting point",
)
