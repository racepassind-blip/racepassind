from types import SimpleNamespace
from uuid import UUID
from unittest.mock import MagicMock, patch

from app.services.product_order_email import build_product_order_confirmation
from app.services import email_service
from app.services.product_order_email import send_product_order_confirmation


def test_merchandise_emails_and_retries_are_disabled():
    db = MagicMock()
    with patch("app.services.product_order_email.send_email") as send:
        assert send_product_order_confirmation(db, order_fixture()).status == "SKIPPED_DISABLED"
        send.assert_not_called()
    with patch.object(email_service, "_deliver_existing_log") as deliver:
        assert email_service.retry_pending_emails(db) == []
        deliver.assert_not_called()
    db.scalars.assert_not_called()


def order_fixture():
    return SimpleNamespace(
        id=UUID("b899bc76-14f9-4c8e-975e-c0fcacc09dad"), status="confirmed",
        buyer_name="Buyer <Test>", buyer_email="buyer@example.com",
        snapshot={"listing_name": "Race shop", "total_paise": 156000,
                  "lines": [{"product_name": "Jersey", "variant_label": "XL", "quantity": 1, "subtotal_paise": 150000}],
                  "delivery_address": {"address": "1 Main Road", "city": "Mysuru", "district": "Mysuru", "state": "Karnataka", "pincode": "570001"}},
    )


def test_delivery_confirmation_escapes_html_and_includes_saved_address():
    content = build_product_order_confirmation(order_fixture())
    assert "SPM-B899BC7614F9" in content["subject"]
    assert "Delivery address:" in content["body"]
    assert "Karnataka — 570001" in content["body"]
    assert "₹1,560.00" in content["body"]
    assert "Pickup instructions" not in content["body"]
    assert "Buyer &lt;Test&gt;" in content["html_body"]


def test_queued_order_email_rebuilds_order_details_on_retry():
    db = MagicMock()
    db.scalar.return_value = SimpleNamespace(enabled=True, configuration={"sender_name": "SportPass", "gmail_address": "sender@gmail.com"})
    db.get.return_value = order_fixture()
    log = SimpleNamespace(recipient="buyer@example.com", subject="Order approved", status="pending_limit", reference_type="PRODUCT_ORDER", reference_id=str(order_fixture().id))
    with patch.object(email_service, "gmail_api_configured", return_value=True), patch.object(email_service, "send_gmail_message") as send:
        assert email_service._deliver_existing_log(db, log).success
    parts = list(send.call_args.args[0].walk())
    plain = next(part for part in parts if part.get_content_type() == "text/plain").get_payload(decode=True).decode()
    assert "SPM-B899BC7614F9" in plain
    assert "Jersey" in plain
    assert "570001" in plain
    assert log.status == "sent"
