import unittest
import io
from urllib.parse import parse_qs, urlparse
from unittest.mock import Mock, patch
from PIL import Image
from fastapi import UploadFile, HTTPException
from starlette.datastructures import Headers
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base, get_db
from models import Organization, ProductListing, ProductOrder, ProductImage
from app.api.v1.products import upload_image, serialize_listing, list_listings, update_listing, set_status, ListingInput, StatusInput, inventory_summary, product_fee_preview, ProductFeePreview
from app.api.v1.products import review, DecisionInput
from app.api.deps import require_csrf
from app.infrastructure.storage.factory import get_storage_service
from main import app


LISTING_ID = UUID("33333333-3333-3333-3333-333333333333")
PRODUCT_ID = UUID("11111111-1111-1111-1111-111111111111")
VARIANT_ID = UUID("22222222-2222-2222-2222-222222222222")


class ProductSalesE2ETests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(bind=cls.engine)

        def db_override():
            db = cls.Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = db_override
        app.dependency_overrides[require_csrf] = lambda: None
        app.dependency_overrides[get_storage_service] = lambda: None
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()
        Base.metadata.drop_all(cls.engine)

    def setUp(self):
        db = self.Session()
        db.query(ProductImage).delete()
        db.query(ProductOrder).delete()
        db.query(ProductListing).delete()
        db.query(Organization).delete()
        organization = Organization(name="E2E Sports", status="active", allow_direct_upi=True, paid_verification_status="VERIFIED")
        db.add(organization)
        db.flush()
        db.add(ProductListing(
            id=LISTING_ID,
            organization_id=organization.id,
            name="Race Day Store",
            description="Breakfast for pickup",
            catalog={
                "listing_type": "products",
                "products": [{
                    "id": str(PRODUCT_ID), "name": "Breakfast", "description": "Fresh box",
                    "image_ids": [], "size_chart_image_id": None, "customization_label": None,
                    "active": True,
                    "variants": [{"id": str(VARIANT_ID), "label": "Vegetarian", "price_paise": 15000, "stock": 10, "options": {}}],
                }],
                "max_units_per_order": 3, "fulfillment": "pickup", "pickup_instructions": "Collect at Gate 1",
            },
            status="published", fee_bearer="PARTICIPANT", upi_id="seller@upi", payee_name="E2E Sports",
        ))
        db.commit()
        db.close()

    def test_uploaded_chart_and_gallery_survive_new_session(self):
        self.place_test_order()
        storage = Mock()
        storage.put_private.side_effect = ["front.png", "back.png", "chart.png"]
        storage.get_read_url.side_effect = lambda key, ttl: f"https://media.test/{key}?signed=fresh"
        payload = io.BytesIO()
        Image.new("RGB", (100, 100), "white").save(payload, format="PNG")
        db = self.Session()
        for kind in ["product", "product", "size"]:
            file = UploadFile(io.BytesIO(payload.getvalue()), filename="image.png", headers=Headers({"content-type": "image/png"}))
            with patch("app.api.v1.products.get_authorized_organization"), patch("app.services.media_service.record_audit"):
                upload_image(LISTING_ID, product_id=PRODUCT_ID, kind=kind, file=file, db=db, user=Mock(id=None), storage=storage)
        db.close()
        with self.Session() as fresh:
            item = fresh.get(ProductListing, LISTING_ID)
            for private in [True, False]:
                result = serialize_listing(fresh, item, storage, private=private)
                product = result["catalog"]["products"][0]
                self.assertEqual(len(product["image_ids"]), 2)
                self.assertEqual(result["images"][product["size_chart_image_id"]], "https://media.test/chart.png?signed=fresh")
                self.assertTrue(all(result["images"][image_id] for image_id in product["image_ids"]))

    def test_draft_can_have_no_products_but_cannot_be_published(self):
        with self.Session() as db, patch("app.api.v1.products.get_authorized_organization"):
            item = db.get(ProductListing, LISTING_ID)
            item.catalog = {**item.catalog, "products": []}
            item.status = "draft"
            db.commit()
            self.assertEqual(serialize_listing(db, item, None, private=True)["catalog"]["products"], [])
            with self.assertRaises(HTTPException) as error:
                set_status(LISTING_ID, StatusInput(status="published"), db=db, user=Mock())
            self.assertEqual(error.exception.status_code, 422)

    def test_published_store_cannot_remove_every_product(self):
        with self.Session() as db, patch("app.api.v1.products.get_authorized_organization"):
            payload = self.editor_payload(db)
            payload.catalog.products = []
            with self.assertRaises(HTTPException) as error:
                update_listing(LISTING_ID, payload, db=db, user=Mock(), storage=None)
            self.assertEqual(error.exception.status_code, 422)

    def test_directory_reports_actionable_order_counts(self):
        order = self.place_test_order()
        with self.Session() as db:
            db.get(ProductOrder, UUID(order["id"])).status = "under_review"
            db.commit()
            listings = list_listings(db=db, user=Mock(role="admin"), storage=None)
            self.assertEqual(listings[0]["order_summary"], {"payment_review": 1, "ready_for_pickup": 0})

    def place_test_order(self):
        response = self.client.post(f"/api/v1/products/{LISTING_ID}/orders", json={
            **self.cart(2), "buyer_name": "Test Buyer", "buyer_email": "buyer@example.com",
            "buyer_phone": "+919999999999", "request_key": str(uuid4()), "access_token": "a" * 64,
        })
        self.assertEqual(response.status_code, 200)
        return response.json()

    def editor_payload(self, db):
        item = db.get(ProductListing, LISTING_ID)
        return ListingInput.model_validate({
            "organization_id": item.organization_id, "name": item.name,
            "description": item.description, "catalog": item.catalog,
            "upi_id": item.upi_id, "payee_name": item.payee_name,
            "fee_bearer": item.fee_bearer,
            "stock_baseline": {str(VARIANT_ID): item.catalog["products"][0]["variants"][0]["stock"]},
        })

    def test_payment_approval_does_not_send_confirmation(self):
        order_id = UUID(self.place_test_order()["id"])
        with self.Session() as db, patch("app.api.v1.products.get_authorized_organization"), patch("app.api.v1.products.debit_credits"), patch("app.services.product_order_email.send_email", return_value=Mock(status="SENT")) as send:
            db.get(ProductOrder, order_id).status = "under_review"
            db.commit()
            result = review(LISTING_ID, order_id, DecisionInput(decision="approve"), db=db, user=Mock())
            self.assertEqual(result["status"], "confirmed")
            self.assertNotIn("email_status", result)
            review(LISTING_ID, order_id, DecisionInput(decision="approve"), db=db, user=Mock())
            review(LISTING_ID, order_id, DecisionInput(decision="fulfilled"), db=db, user=Mock())
            send.assert_not_called()

    def test_rejection_does_not_send_confirmation(self):
        order_id = UUID(self.place_test_order()["id"])
        with self.Session() as db, patch("app.api.v1.products.get_authorized_organization"), patch("app.services.product_order_email.send_email") as send:
            db.get(ProductOrder, order_id).status = "under_review"
            db.commit()
            review(LISTING_ID, order_id, DecisionInput(decision="reject"), db=db, user=Mock())
            send.assert_not_called()

    def test_edit_after_order_preserves_reservations_and_order_snapshot(self):
        with self.Session() as db:
            payload = self.editor_payload(db)
        order = self.place_test_order()
        payload.catalog.products[0].name = "Updated jersey"
        payload.catalog.products[0].variants[0].stock = 15  # Add five to the original ten.
        with self.Session() as db, patch("app.api.v1.products.get_authorized_organization"):
            result = update_listing(LISTING_ID, payload, db=db, user=Mock(), storage=None)
            self.assertEqual(result["catalog"]["products"][0]["variants"][0]["stock"], 13)
            stored_order = db.get(ProductOrder, UUID(order["id"]))
            self.assertEqual(stored_order.snapshot["lines"][0]["product_name"], "Breakfast")
        with self.Session() as db:
            payload = self.editor_payload(db)
        payload.catalog.products[0].name = "Another name"
        self.place_test_order()
        with self.Session() as db, patch("app.api.v1.products.get_authorized_organization"):
            result = update_listing(LISTING_ID, payload, db=db, user=Mock(), storage=None)
            self.assertEqual(result["catalog"]["products"][0]["variants"][0]["stock"], 11)

    def test_reject_unsafe_stock_reduction_and_variant_removal(self):
        with self.Session() as db:
            payload = self.editor_payload(db)
        self.place_test_order()
        payload.catalog.products[0].variants[0].stock = 0
        with self.Session() as db, patch("app.api.v1.products.get_authorized_organization"):
            with self.assertRaises(HTTPException) as caught:
                update_listing(LISTING_ID, payload, db=db, user=Mock(), storage=None)
            self.assertEqual(caught.exception.status_code, 409)
        with self.Session() as db:
            payload = self.editor_payload(db)
        payload.catalog.products[0].variants[0].id = uuid4()
        with self.Session() as db, patch("app.api.v1.products.get_authorized_organization"):
            with self.assertRaises(HTTPException) as caught:
                update_listing(LISTING_ID, payload, db=db, user=Mock(), storage=None)
            self.assertEqual(caught.exception.status_code, 409)

    def test_size_summary_counts_units_by_id_and_excludes_inactive_orders(self):
        order = self.place_test_order()
        with self.Session() as db:
            original = db.get(ProductOrder, UUID(order["id"]))
            original.status = "confirmed"
            for index, status in enumerate(["under_review", "fulfilled", "rejected", "expired"]):
                db.add(ProductOrder(listing_id=LISTING_ID, request_key=str(uuid4()), access_hash="test",
                    buyer_name="Buyer", buyer_email="test@example.com", buyer_phone="1234567890",
                    status=status, snapshot=original.snapshot))
            item = db.get(ProductListing, LISTING_ID)
            catalog = {**item.catalog, "products": [{**item.catalog["products"][0], "name": "Renamed jersey"}]}
            item.catalog = catalog
            db.commit()
            with patch("app.api.v1.products.get_authorized_organization"):
                result = inventory_summary(LISTING_ID, db=db, user=Mock())
            product = result["products"][0]
            self.assertEqual(product["name"], "Renamed jersey")
            row = product["variants"][0]
            self.assertEqual(row["available"], 8)
            self.assertEqual(row["confirmed"], 2)
            self.assertEqual(row["under_review"], 2)
            self.assertEqual(row["fulfilled"], 2)
            self.assertEqual(row["awaiting_payment"], 0)

    def cart(self, quantity):
        return {"lines": [{"product_id": str(PRODUCT_ID), "variant_id": str(VARIANT_ID), "quantity": quantity, "customization": None}]}

    def test_browser_preflight_allows_order_token_for_payment_reference(self):
        response = self.client.options(
            f"/api/v1/product-orders/{uuid4()}/reference",
            headers={
                "Origin": "http://localhost:8080",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-csrf-token,x-order-token,x-request-id",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:8080")
        self.assertIn("x-order-token", response.headers["access-control-allow-headers"].lower())

    def test_pricing_preview_shows_actual_organizer_net(self):
        with self.Session() as db, patch("app.api.v1.products.get_authorized_organization"):
            organization_id = db.get(ProductListing, LISTING_ID).organization_id
            for bearer, paid, net in [("ORGANIZER", 150000, 144000), ("PARTICIPANT", 156000, 150000)]:
                result = product_fee_preview(ProductFeePreview(organization_id=organization_id, amount_paise=150000, fee_bearer=bearer), db=db, user=Mock())
                self.assertEqual(result["platformFeePaise"], 6000)
                self.assertEqual(result["customerPaysPaise"], paid)
                self.assertEqual(result["organizerNetPaise"], net)

    def test_fee_bearer_matches_product_preview_cart_and_upi_qr(self):
        from app.services.payment_service import generate_qr_data_url
        for bearer, expected_total in [("PARTICIPANT", 312000), ("ORGANIZER", 300000)]:
            with self.subTest(bearer=bearer):
                with self.Session() as db:
                    item = db.get(ProductListing, LISTING_ID)
                    item.fee_bearer = bearer
                    catalog = dict(item.catalog)
                    catalog["products"] = [{**catalog["products"][0], "variants": [{"id": str(VARIANT_ID), "label": "M", "price_paise": 150000, "stock": 10, "options": {}}]}]
                    item.catalog = catalog
                    db.commit()
                store = self.client.get(f"/api/v1/products/{LISTING_ID}").json()
                preview = store["price_previews"][str(VARIANT_ID)]
                self.assertEqual(preview["participantTotalPaise"], 156000 if bearer == "PARTICIPANT" else 150000)
                quote = self.client.post(f"/api/v1/products/{LISTING_ID}/quote", json=self.cart(2)).json()
                self.assertEqual(quote["total_paise"], expected_total)
                order = self.place_test_order()
                payment = order["snapshot"]["payment"]
                self.assertEqual(order["snapshot"]["platform_fee_paise"], 12000)
                self.assertEqual(payment["amountPaise"], expected_total)
                self.assertEqual(parse_qs(urlparse(payment["upiUri"]).query)["am"], [f"{expected_total / 100:.2f}"])
                self.assertEqual(payment["qrDataUrl"], generate_qr_data_url(payment["upiUri"]))

    def test_public_store_quote_order_and_payment_reference(self):
        discovery = self.client.get("/api/v1/products")
        self.assertEqual(discovery.status_code, 200)
        self.assertEqual(discovery.json()[0]["id"], str(LISTING_ID))

        storefront = self.client.get(f"/api/v1/products/{LISTING_ID}")
        self.assertEqual(storefront.status_code, 200)
        self.assertEqual(storefront.json()["catalog"]["max_units_per_order"], 3)

        quote = self.client.post(f"/api/v1/products/{LISTING_ID}/quote", json=self.cart(2))
        self.assertEqual(quote.status_code, 200)
        self.assertEqual(quote.json()["subtotal_paise"], 30000)
        self.assertGreater(quote.json()["platform_fee_paise"], 0)

        too_many = self.client.post(f"/api/v1/products/{LISTING_ID}/quote", json=self.cart(4))
        self.assertEqual(too_many.status_code, 422)
        self.assertIn("Maximum 3", too_many.json()["detail"])

        token = "a" * 64
        body = {
            **self.cart(2), "buyer_name": "Test Buyer", "buyer_email": "buyer@example.com",
            "buyer_phone": "+919999999999", "request_key": str(uuid4()), "access_token": token,
        }
        placed = self.client.post(f"/api/v1/products/{LISTING_ID}/orders", json=body)
        self.assertEqual(placed.status_code, 200)
        order = placed.json()
        self.assertEqual(order["status"], "awaiting_payment")
        self.assertTrue(order["snapshot"]["payment"]["upiUri"].startswith("upi://pay?"))
        self.assertIn(f"SportPass%20Order%20{order['id']}", order["snapshot"]["payment"]["upiUri"])

        repeated = self.client.post(f"/api/v1/products/{LISTING_ID}/orders", json=body)
        self.assertEqual(repeated.json()["id"], order["id"])

        submitted = self.client.post(
            f"/api/v1/product-orders/{order['id']}/reference",
            headers={"X-Order-Token": token}, json={"reference": "UTR12345678"},
        )
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.json()["status"], "under_review")

        db = self.Session()
        listing = db.get(ProductListing, LISTING_ID)
        self.assertEqual(listing.catalog["products"][0]["variants"][0]["stock"], 8)
        db.close()


if __name__ == "__main__":
    unittest.main()
