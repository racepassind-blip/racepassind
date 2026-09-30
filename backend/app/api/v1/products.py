"""Standalone pickup product sales using shared media, UPI, and credit services."""
import datetime as dt
import hashlib
import hmac
from types import SimpleNamespace
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from db import get_db
from models import Organization, OrganizationMember, ProductListing, ProductImage, ProductOrder, User
from app.api.deps import get_authorized_organization, require_csrf, require_roles
from app.config import get_settings
from app.infrastructure.storage.factory import get_storage_service
from app.listings.products import ProductCatalog, ProductCart, price_product_order
from app.services.auth_service import utc_now, validate_required_phone
from app.services.media_service import upload_media, resolve_media_url
from app.services.image_validation import ImageValidationError
from app.services.storage_service import StorageError
from app.services.payment_service import normalize_upi_id, normalize_payment_reference, build_upi_payment_details
from app.services.platform_fee_service import compute_product_order_pricing
from app.services.product_order_email import send_product_order_cancellation
from app.services.credit_service import debit_credits, CreditValidationError

router = APIRouter()


class ListingInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    organization_id: UUID
    name: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=5000)
    catalog: ProductCatalog
    stock_baseline: dict[UUID, int] | None = None
    fee_bearer: Literal["ORGANIZER", "PARTICIPANT"] = "ORGANIZER"
    upi_id: str = Field(max_length=320)
    payee_name: str = Field(default="", max_length=200)

    @field_validator("payee_name", mode="before")
    @classmethod
    def _normalize_payee_name(cls, value):
        return value.strip() if isinstance(value, str) else "" if value is None else value


class OrderInput(ProductCart):
    buyer_name: str = Field(min_length=2, max_length=160)
    buyer_email: str = Field(default="", pattern=r"^$|^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=320)
    buyer_phone: str = Field(min_length=10, max_length=20)
    delivery_address: str | None = Field(default=None, max_length=500)
    delivery_state: str | None = Field(default=None, max_length=100)
    delivery_district: str | None = Field(default=None, max_length=100)
    delivery_city: str | None = Field(default=None, max_length=100)
    delivery_pincode: str | None = Field(default=None, pattern=r"^[1-9][0-9]{5}$")

    @field_validator("buyer_email", mode="before")
    @classmethod
    def _normalize_buyer_email(cls, value):
        return value.strip() if isinstance(value, str) else "" if value is None else value

    @field_validator("buyer_phone")
    @classmethod
    def _validate_buyer_phone(cls, value: str) -> str:
        return validate_required_phone(value)
    request_key: UUID
    access_token: str = Field(min_length=32, max_length=128)


class StatusInput(BaseModel):
    status: Literal["published", "closed"]


class ReferenceInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    reference: str = Field(min_length=4, max_length=120)


class DecisionInput(BaseModel):
    decision: Literal["approve", "reject", "fulfilled", "cancel"]


class ProductFeePreview(BaseModel):
    organization_id: UUID
    amount_paise: int = Field(ge=0, le=100_000_000)
    fee_bearer: Literal["ORGANIZER", "PARTICIPANT"] = "ORGANIZER"


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def listing(db, listing_id, user=None):
    item = db.scalar(select(ProductListing).where(ProductListing.id == listing_id).with_for_update())
    if item is None:
        raise HTTPException(404, "Product listing not found")
    if user is not None:
        get_authorized_organization(db, user, item.organization_id)
    return item


@router.post("/organizer/product-fee-preview")
def product_fee_preview(payload: ProductFeePreview, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin"))):
    organization = get_authorized_organization(db, user, payload.organization_id)
    pricing = compute_product_order_pricing(base_amount_paise=payload.amount_paise, fee_bearer=payload.fee_bearer)
    return {
        "amountPaise": payload.amount_paise,
        "platformFeePaise": pricing["platformFeePaise"],
        "customerPaysPaise": pricing["participantTotalPaise"],
        "organizerNetPaise": pricing["participantTotalPaise"] - pricing["platformFeePaise"],
        "feeBearer": payload.fee_bearer,
        "percentageBasisPoints": pricing["percentageBasisPoints"],
        "minimumFeePaise": pricing["minimumFeePaise"],
        "maximumFeePaise": pricing["maximumFeePaise"],
    }


def restore_stock(item, order):
    catalog = ProductCatalog.model_validate(item.catalog)
    quantities = {}
    for line in order.snapshot["lines"]:
        quantities[line["variant_id"]] = quantities.get(line["variant_id"], 0) + line["quantity"]
    for product in catalog.products:
        for variant in product.variants:
            variant.stock += quantities.get(str(variant.id), 0)
    item.catalog = catalog.model_dump(mode="json")


def expire_orders(db, item):
    now = utc_now()
    expired = db.scalars(select(ProductOrder).where(ProductOrder.listing_id == item.id, ProductOrder.status == "awaiting_payment", ProductOrder.reserved_until < now).with_for_update()).all()
    for order in expired:
        restore_stock(item, order)
        order.status = "expired"
        order.reserved_until = None


def serialize_listing(db, item, storage, private=False):
    images = db.scalars(select(ProductImage).where(ProductImage.listing_id == item.id)).all()
    organization = db.get(Organization, item.organization_id)
    result = {"id": str(item.id), "name": item.name, "description": item.description, "catalog": item.catalog, "status": item.status, "fee_bearer": item.fee_bearer, "images": {str(image.id): resolve_media_url(image.reference, storage, get_settings().storage_signed_url_ttl_seconds) for image in images}, "organizer": {"name": organization.name if organization else "Organizer", "logo_url": resolve_media_url(organization.logo_url, storage, get_settings().storage_signed_url_ttl_seconds) if organization else None}}
    result["price_previews"] = {
        str(variant.id): compute_product_order_pricing(base_amount_paise=variant.price_paise, fee_bearer=item.fee_bearer)
        for product in ProductCatalog.model_validate(item.catalog).products for variant in product.variants
    }
    if private:
        result.update(organization_id=str(item.organization_id), upi_id=item.upi_id, payee_name=item.payee_name)
        result["has_orders"] = db.scalar(select(ProductOrder.id).where(ProductOrder.listing_id == item.id).limit(1)) is not None
    return result


def validate_images(db, item_id, catalog):
    ids = {image_id for product in catalog.products for image_id in product.image_ids}
    ids.update(product.size_chart_image_id for product in catalog.products if product.size_chart_image_id)
    owned = set(db.scalars(select(ProductImage.id).where(ProductImage.listing_id == item_id, ProductImage.id.in_(ids))).all()) if ids else set()
    if ids != owned:
        raise HTTPException(422, "Use images uploaded to this listing")


@router.post("/organizer/product-listings", dependencies=[Depends(require_csrf)])
def create_listing(payload: ListingInput, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin")), storage=Depends(get_storage_service)):
    get_authorized_organization(db, user, payload.organization_id)
    try:
        upi_id = normalize_upi_id(payload.upi_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if any(product.image_ids or product.size_chart_image_id for product in payload.catalog.products):
        raise HTTPException(422, "Save the listing before uploading images")
    item = ProductListing(organization_id=payload.organization_id, name=payload.name, description=payload.description, catalog=payload.catalog.model_dump(mode="json"), upi_id=upi_id, payee_name=payload.payee_name, fee_bearer=payload.fee_bearer, status="draft")
    db.add(item)
    db.commit()
    return serialize_listing(db, item, storage, True)


@router.get("/organizer/product-listings")
def list_listings(db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin")), storage=Depends(get_storage_service)):
    if user.role == "admin":
        items = db.scalars(select(ProductListing).order_by(ProductListing.created_at.desc())).all()
    else:
        organization_ids = select(OrganizationMember.organization_id).where(OrganizationMember.user_id == user.id)
        items = db.scalars(select(ProductListing).where(ProductListing.organization_id.in_(organization_ids)).order_by(ProductListing.created_at.desc())).all()
    order_counts: dict[str, dict[str, int]] = {}
    if items:
        counts = db.execute(
            select(ProductOrder.listing_id, ProductOrder.status, func.count(ProductOrder.id))
            .where(ProductOrder.listing_id.in_([item.id for item in items]))
            .group_by(ProductOrder.listing_id, ProductOrder.status)
        ).all()
        for listing_id, order_status, count in counts:
            order_counts.setdefault(str(listing_id), {})[order_status] = count
    return [
        {**serialize_listing(db, item, storage, True), "order_summary": {
            "payment_review": order_counts.get(str(item.id), {}).get("under_review", 0),
            "ready_for_pickup": order_counts.get(str(item.id), {}).get("confirmed", 0),
        }}
        for item in items
    ]


@router.get("/organizer/product-listings/{listing_id}")
def get_listing(listing_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin")), storage=Depends(get_storage_service)):
    item = listing(db, listing_id, user)
    expire_orders(db, item)
    db.commit()
    return serialize_listing(db, item, storage, True)


@router.put("/organizer/product-listings/{listing_id}", dependencies=[Depends(require_csrf)])
def update_listing(listing_id: UUID, payload: ListingInput, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin")), storage=Depends(get_storage_service)):
    item = listing(db, listing_id, user)
    if payload.organization_id != item.organization_id:
        raise HTTPException(422, "A listing cannot be transferred to another organization")
    if item.status == "published" and not any(product.active for product in payload.catalog.products):
        raise HTTPException(422, "Close sales before removing every active product")
    expire_orders(db, item)
    current = ProductCatalog.model_validate(item.catalog)
    has_orders = db.scalar(select(ProductOrder.id).where(ProductOrder.listing_id == item.id).limit(1)) is not None
    incoming = {p.id: p for p in payload.catalog.products}
    for product in current.products:
        replacement = incoming.get(product.id)
        if has_orders and (replacement is None or not {v.id for v in product.variants}.issubset({v.id for v in replacement.variants})):
            raise HTTPException(409, "Products and sizes with order history cannot be removed. Set stock to 0 instead.")
        if replacement is None:
            continue
        existing = {v.id: v for v in product.variants}
        for variant in replacement.variants:
            previous = existing.get(variant.id)
            if previous is None:
                continue
            baseline = (payload.stock_baseline or {}).get(variant.id)
            if baseline is None:
                if has_orders:
                    raise HTTPException(409, "Reload the editor before saving inventory changes.")
                continue
            if baseline < 0:
                raise HTTPException(422, "Invalid stock baseline")
            # Apply the organizer's adjustment to live stock under the listing lock.
            # Orders and expired reservations since the editor opened stay accounted for.
            adjusted = previous.stock + variant.stock - baseline
            if adjusted < 0 or adjusted > 1_000_000:
                raise HTTPException(409, "Stock changed while editing. Reload the editor and review inventory before saving.")
            variant.stock = adjusted
    validate_images(db, item.id, payload.catalog)
    try:
        item.upi_id = normalize_upi_id(payload.upi_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    item.name, item.description, item.payee_name, item.fee_bearer = payload.name, payload.description, payload.payee_name, payload.fee_bearer
    item.catalog = payload.catalog.model_dump(mode="json")
    db.commit()
    return serialize_listing(db, item, storage, True)


@router.post("/organizer/product-listings/{listing_id}/images", dependencies=[Depends(require_csrf)])
def upload_image(listing_id: UUID, product_id: UUID | None = None, kind: Literal["product", "size"] = "product", file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin")), storage=Depends(get_storage_service)):
    item = listing(db, listing_id, user)
    catalog = ProductCatalog.model_validate(item.catalog)
    product = next((p for p in catalog.products if p.id == product_id), None)
    if product_id is not None:
        if product is None:
            raise HTTPException(422, "Save this product before uploading images")
        if kind == "product" and len(product.image_ids) >= 8:
            raise HTTPException(422, "A product can have up to 8 photos")
    image = ProductImage(listing_id=item.id)
    db.add(image)
    db.flush()
    if product is not None:
        if kind == "size":
            product.size_chart_image_id = image.id
        else:
            product.image_ids.append(image.id)
        # upload_media commits the media reference and catalog association together.
        item.catalog = catalog.model_dump(mode="json")
    settings = get_settings()
    try:
        uploaded = upload_media(db, owner=image, owner_type="product_image", owner_id=image.id, reference_field="reference", actor_user_id=user.id, payload=file.file.read(settings.storage_max_upload_bytes + 1), filename=file.filename, content_type=file.content_type, purpose="product-image", storage=storage, max_upload_bytes=settings.storage_max_upload_bytes, max_dimension=settings.storage_max_dimension, signed_url_ttl_seconds=settings.storage_signed_url_ttl_seconds)
    except (ImageValidationError, StorageError) as exc:
        raise HTTPException(422, str(exc))
    return {"id": str(image.id), "url": uploaded.url}


@router.post("/organizer/product-listings/{listing_id}/status", dependencies=[Depends(require_csrf)])
def set_status(listing_id: UUID, payload: StatusInput, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin"))):
    item = listing(db, listing_id, user)
    org = db.get(Organization, item.organization_id)
    if payload.status == "published":
        catalog = ProductCatalog.model_validate(item.catalog)
        if not any(product.active for product in catalog.products):
            raise HTTPException(422, "Add at least one active product before publishing")
        if not org.allow_direct_upi:
            raise HTTPException(422, "Product sales currently require Direct UPI access")
        if org.credit_deduction_mode == "MANUAL_EVENT_SETTLEMENT":
            raise HTTPException(422, "Product sales require automatic SportPass credit settlement")
        if any(v.price_paise > 0 for p in catalog.products for v in p.variants) and org.paid_verification_status != "VERIFIED":
            raise HTTPException(422, "Complete paid organizer verification before publishing")
    item.status = payload.status
    db.commit()
    return {"status": item.status}


@router.get("/products")
def public_listings(db: Session = Depends(get_db), storage=Depends(get_storage_service)):
    items = db.scalars(select(ProductListing).where(ProductListing.status == "published").order_by(ProductListing.created_at.desc()).limit(24)).all()
    return [serialize_listing(db, item, storage) for item in items]


@router.get("/products/{listing_id}")
def public_listing(listing_id: UUID, db: Session = Depends(get_db), storage=Depends(get_storage_service)):
    item = listing(db, listing_id)
    if item.status not in {"published", "closed"}:
        raise HTTPException(404, "Product listing not available")
    expire_orders(db, item)
    db.commit()
    return serialize_listing(db, item, storage)


@router.post("/products/{listing_id}/quote", dependencies=[Depends(require_csrf)])
def quote(listing_id: UUID, payload: ProductCart, db: Session = Depends(get_db)):
    item = listing(db, listing_id)
    if item.status != "published":
        raise HTTPException(422, "Sales are closed")
    expire_orders(db, item)
    try:
        result = price_product_order(db, catalog=ProductCatalog.model_validate(item.catalog), cart=payload, organization=db.get(Organization, item.organization_id), fee_bearer=item.fee_bearer)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    db.commit()
    return result


def serialize_order(order):
    return {"id": str(order.id), "status": order.status, "snapshot": order.snapshot, "reserved_until": order.reserved_until, "payment_reference": order.payment_reference}


@router.post("/products/{listing_id}/orders", dependencies=[Depends(require_csrf)])
def place_order(listing_id: UUID, payload: OrderInput, db: Session = Depends(get_db)):
    item = listing(db, listing_id)
    existing = db.scalar(select(ProductOrder).where(ProductOrder.request_key == str(payload.request_key)))
    if existing:
        if existing.listing_id != item.id or not hmac.compare_digest(existing.access_hash, digest(payload.access_token)):
            raise HTTPException(409, "Order request already used")
        return serialize_order(existing)
    if item.status != "published":
        raise HTTPException(422, "Sales are closed")
    expire_orders(db, item)
    catalog = ProductCatalog.model_validate(item.catalog)
    if catalog.fulfillment == "home_delivery" or catalog.delivery_address_required:
        required_delivery = {
            "address": payload.delivery_address,
            "state": payload.delivery_state,
            "district": payload.delivery_district,
            "city": payload.delivery_city,
            "pincode": payload.delivery_pincode,
        }
        if any(not value or not value.strip() for value in required_delivery.values()):
            raise HTTPException(422, "Complete the delivery address, state, district, city, and pincode")
    try:
        result = price_product_order(db, catalog=catalog, cart=payload, organization=db.get(Organization, item.organization_id), fee_bearer=item.fee_bearer)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    for line in payload.lines:
        product = next(p for p in catalog.products if p.id == line.product_id)
        variant = next(v for v in product.variants if v.id == line.variant_id)
        variant.stock -= line.quantity
    item.catalog = catalog.model_dump(mode="json")
    order = ProductOrder(listing_id=item.id, request_key=str(payload.request_key), access_hash=digest(payload.access_token), buyer_name=payload.buyer_name, buyer_email=str(payload.buyer_email), buyer_phone=payload.buyer_phone, snapshot=result, status="awaiting_payment" if result["total_paise"] else "confirmed", reserved_until=utc_now() + dt.timedelta(minutes=30) if result["total_paise"] else None)
    db.add(order)
    db.flush()
    result = {**result, "fulfillment": catalog.fulfillment, "pickup_instructions": catalog.pickup_instructions, "listing_name": item.name}
    if catalog.fulfillment == "home_delivery" or catalog.delivery_address_required:
        result["delivery_address"] = {
            "address": payload.delivery_address.strip(),
            "state": payload.delivery_state.strip(),
            "district": payload.delivery_district.strip(),
            "city": payload.delivery_city.strip(),
            "pincode": payload.delivery_pincode,
        }
    if result["total_paise"]:
        settings = SimpleNamespace(method="manual_upi", is_active=True, upi_id=item.upi_id, payee_name=(item.payee_name or "").strip() or item.name, instructions="Pay the exact total, then submit your payment reference for organizer review.", qr_image_url=None)
        result["payment"] = build_upi_payment_details(settings, amount_paise=result["total_paise"], registration_reference=str(order.id), merchandise_order=True)
    order.snapshot = result
    db.commit()
    return serialize_order(order)


@router.delete("/organizer/product-listings/{listing_id}/orders/{order_id}", dependencies=[Depends(require_csrf)])
def delete_order(listing_id: UUID, order_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin"))):
    item = listing(db, listing_id, user)
    order = db.scalar(select(ProductOrder).where(ProductOrder.id == order_id, ProductOrder.listing_id == item.id).with_for_update())
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.status not in {"expired", "rejected", "cancelled"}:
        raise HTTPException(409, "Only expired, rejected, or cancelled orders can be deleted")
    db.delete(order)
    db.commit()
    return {"deleted": True, "id": str(order_id)}


@router.post("/organizer/product-listings/{listing_id}/orders/{order_id}/cancellation-email", dependencies=[Depends(require_csrf)])
def send_cancellation_email(listing_id: UUID, order_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin"))):
    item = listing(db, listing_id, user)
    order = db.scalar(select(ProductOrder).where(ProductOrder.id == order_id, ProductOrder.listing_id == item.id))
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.status != "cancelled":
        raise HTTPException(409, "Only cancelled orders can notify the buyer")
    if not order.buyer_email:
        raise HTTPException(409, "No email address was provided for this order")
    result = send_product_order_cancellation(db, order)
    return {"email_status": result.status}


def authorized_order(db, order_id, token):
    candidate = db.get(ProductOrder, order_id)
    if candidate is None or not token or not hmac.compare_digest(candidate.access_hash, digest(token)):
        raise HTTPException(404, "Order not found")
    item = listing(db, candidate.listing_id)
    expire_orders(db, item)
    db.flush()
    return item, candidate


@router.get("/product-orders/{order_id}")
def get_order(order_id: UUID, x_order_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    _, order = authorized_order(db, order_id, x_order_token)
    db.commit()
    return serialize_order(order)


@router.post("/product-orders/{order_id}/reference", dependencies=[Depends(require_csrf)])
def submit_reference(order_id: UUID, payload: ReferenceInput, x_order_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    item, order = authorized_order(db, order_id, x_order_token)
    if order.status != "awaiting_payment":
        raise HTTPException(409, "This order is no longer awaiting a payment reference")
    try:
        reference = normalize_payment_reference(payload.reference)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if not reference:
        raise HTTPException(422, "UTR / transaction reference is required to submit payment")
    order.payment_reference = reference
    order.status = "under_review"
    order.reserved_until = None
    db.commit()
    return serialize_order(order)


def summarize_product_inventory(db, item):
    products = []
    variants = {}
    for product in ProductCatalog.model_validate(item.catalog).products:
        rows = []
        for variant in product.variants:
            row = {"id": str(variant.id), "label": variant.label, "available": variant.stock,
                   "awaiting_payment": 0, "under_review": 0, "confirmed": 0, "fulfilled": 0}
            rows.append(row)
            variants[(str(product.id), str(variant.id))] = row
        products.append({"id": str(product.id), "name": product.name, "variants": rows})
    # All orders, independent of the paginated order list and its filters.
    for status, snapshot in db.execute(select(ProductOrder.status, ProductOrder.snapshot).where(
        ProductOrder.listing_id == item.id,
        ProductOrder.status.in_(["awaiting_payment", "under_review", "confirmed", "fulfilled"]),
    )):
        for line in snapshot["lines"]:
            row = variants.get((line["product_id"], line["variant_id"]))
            if row is not None:
                row[status] += line["quantity"]
    return {"products": products}


@router.get("/organizer/product-listings/{listing_id}/inventory-summary")
def inventory_summary(listing_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin"))):
    item = listing(db, listing_id, user)
    expire_orders(db, item)
    db.flush()
    result = summarize_product_inventory(db, item)
    db.commit()
    return result


@router.get("/organizer/product-listings/{listing_id}/orders")
def orders(listing_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin"))):
    item = listing(db, listing_id, user)
    expire_orders(db, item)
    db.commit()
    return [{**serialize_order(order), "buyer_name": order.buyer_name, "buyer_email": order.buyer_email, "buyer_phone": order.buyer_phone} for order in db.scalars(select(ProductOrder).where(ProductOrder.listing_id == item.id).order_by(ProductOrder.created_at.desc()).limit(500)).all()]


@router.post("/organizer/product-listings/{listing_id}/orders/{order_id}", dependencies=[Depends(require_csrf)])
def review(listing_id: UUID, order_id: UUID, payload: DecisionInput, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "admin"))):
    item = listing(db, listing_id, user)
    order = db.scalar(select(ProductOrder).where(ProductOrder.id == order_id, ProductOrder.listing_id == item.id).with_for_update())
    if order is None:
        raise HTTPException(404, "Order not found")
    target = {"approve": "confirmed", "reject": "rejected", "fulfilled": "fulfilled", "cancel": "cancelled"}[payload.decision]
    if order.status == target:
        return serialize_order(order)
    if payload.decision == "cancel":
        if order.status not in {"awaiting_payment", "under_review", "confirmed"}:
            raise HTTPException(409, "Only unfulfilled active orders can be cancelled")
    elif payload.decision == "fulfilled":
        if order.status != "confirmed":
            raise HTTPException(409, "Only confirmed orders can be fulfilled")
    elif order.status != "under_review":
        raise HTTPException(409, "Only submitted payments can be reviewed")
    if payload.decision == "approve" and order.snapshot["platform_fee_paise"]:
        try:
            debit_credits(db, organization_id=item.organization_id, amount=order.snapshot["platform_fee_paise"], transaction_type="REGISTRATION_DEBIT", description="SportPass fee for product order", source_type="PRODUCT_ORDER", source_id=str(order.id), created_by=user.id)
        except CreditValidationError as exc:
            raise HTTPException(422, str(exc))
    if payload.decision in {"reject", "cancel"}:
        restore_stock(item, order)
        order.reserved_until = None
    order.status = target
    db.commit()
    return serialize_order(order)
