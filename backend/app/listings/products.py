"""Product catalog and trusted order quotation.

Prices and availability come from the server catalog, never the cart. Stock
reservation must run under a database lock when a quoted order is submitted.
"""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProductVariant(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: UUID
    label: str = Field(min_length=1, max_length=120)
    price_paise: int = Field(strict=True, ge=0, le=100_000_000)
    stock: int = Field(strict=True, ge=0, le=1_000_000)
    options: dict[str, str] = Field(default_factory=dict, max_length=5)

    @model_validator(mode="after")
    def valid_options(self):
        if any(not key.strip() or not value.strip() or len(key) > 60 or len(value) > 120 for key, value in self.options.items()):
            raise ValueError("Variant options must have non-empty names and values")
        return self


class Product(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: UUID
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=5000)
    # References to validated uploads; arbitrary external URLs are not catalog media.
    image_ids: list[UUID] = Field(default_factory=list, max_length=8)
    size_chart_image_id: UUID | None = None
    customization_label: str | None = Field(default=None, min_length=1, max_length=120)
    active: bool = True
    variants: list[ProductVariant] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_variants(self):
        if len({variant.id for variant in self.variants}) != len(self.variants):
            raise ValueError("Variant IDs must be unique within a product")
        return self


class ProductCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    listing_type: Literal["products"] = "products"
    products: list[Product] = Field(min_length=1, max_length=100)
    max_units_per_order: int = Field(default=10, strict=True, ge=1, le=100)
    fulfillment: Literal["pickup"] = "pickup"
    pickup_instructions: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({product.id for product in self.products}) != len(self.products):
            raise ValueError("Product IDs must be unique")
        ids = [variant.id for product in self.products for variant in product.variants]
        if len(set(ids)) != len(ids):
            raise ValueError("Variant IDs must be unique across the catalog")
        return self


class ProductCartLine(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    product_id: UUID
    variant_id: UUID
    quantity: int = Field(strict=True, ge=1, le=100)
    customization: str | None = Field(default=None, max_length=120)


class ProductCart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lines: list[ProductCartLine] = Field(min_length=1, max_length=100)


def quote_products(catalog: ProductCatalog, cart: ProductCart) -> dict:
    """Validate a cart and snapshot product labels/prices, before platform fees."""
    if sum(line.quantity for line in cart.lines) > catalog.max_units_per_order:
        raise ValueError(f"Maximum {catalog.max_units_per_order} product units per order")
    products = {product.id: product for product in catalog.products}
    requested: dict[UUID, int] = {}
    lines = []
    for line in cart.lines:
        product = products.get(line.product_id)
        if product is None or not product.active:
            raise ValueError("This product is no longer available")
        variant = next((item for item in product.variants if item.id == line.variant_id), None)
        if variant is None:
            raise ValueError("Choose a valid product option")
        requested[variant.id] = requested.get(variant.id, 0) + line.quantity
        if requested[variant.id] > variant.stock:
            raise ValueError(f"Not enough stock for {product.name} — {variant.label}")
        if line.customization and not product.customization_label:
            raise ValueError(f"Customization is not offered for {product.name}")
        lines.append({
            "product_id": str(product.id), "variant_id": str(variant.id),
            "product_name": product.name, "variant_label": variant.label,
            "options": dict(variant.options), "quantity": line.quantity,
            "unit_price_paise": variant.price_paise,
            "subtotal_paise": variant.price_paise * line.quantity,
            "customization_label": product.customization_label,
            "customization": line.customization or None,
        })
    return {"currency": "INR", "lines": lines, "subtotal_paise": sum(line["subtotal_paise"] for line in lines)}


def price_product_order(db, *, catalog: ProductCatalog, cart: ProductCart, organization, fee_bearer: str) -> dict:
    """Apply the organizer's pricing policy exactly once to the whole order."""
    from app.services.platform_fee_service import compute_participant_pricing

    if fee_bearer not in {"ORGANIZER", "PARTICIPANT"}:
        raise ValueError("Choose a valid fee bearer")
    quote = quote_products(catalog, cart)
    pricing = compute_participant_pricing(
        db,
        base_amount_paise=quote["subtotal_paise"],
        fee_bearer=fee_bearer,
        organization=organization,
        participant_count=1,
    )
    return {
        **quote,
        "platform_fee_paise": pricing["platformFeePaise"],
        "fee_bearer": "buyer" if fee_bearer == "PARTICIPANT" else "organizer",
        "total_paise": pricing["participantTotalPaise"],
        "pricing_snapshot": pricing,
    }
