"""Explicit listing-kind dispatch. Product sales are not a sport."""
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class ListingAdapter:
    kind: Literal["event", "products"]
    requires_ticket: bool
    uses_participant_profiles: bool
    supports_tournament: bool
    supports_product_images: bool
    supports_size_chart: bool
    fee_unit: Literal["registration", "order"]


EVENT = ListingAdapter("event", True, True, True, False, False, "registration")
PRODUCTS = ListingAdapter("products", False, False, False, True, True, "order")


def get_listing_adapter(kind: str = "event") -> ListingAdapter:
    if kind == "event":
        return EVENT
    if kind == "products":
        return PRODUCTS
    raise ValueError("Unknown listing type")
