"""Cashfree PG adapter. Only this server may turn Cashfree API data into payment evidence."""
from __future__ import annotations

import base64
from decimal import Decimal, InvalidOperation
import hashlib
import hmac

import httpx

from app.config import get_settings
from app.services.checkout_payments import ProviderUnavailable, VerifiedReceipt, rupees

API_VERSION = "2025-01-01"
BASE_URLS = {"sandbox": "https://sandbox.cashfree.com", "production": "https://api.cashfree.com"}


def amount_paise(value) -> int:
    try:
        amount = Decimal(str(value)) * 100
    except (InvalidOperation, ValueError):
        raise ProviderUnavailable("Invalid Cashfree amount") from None
    if not amount.is_finite() or amount < 0 or amount != amount.to_integral_value():
        raise ProviderUnavailable("Invalid Cashfree amount")
    return int(amount)


class CashfreeGateway:
    def __init__(self):
        settings = get_settings()
        if not settings.cashfree_ready:
            raise ProviderUnavailable("Cashfree is not configured")
        if settings.cashfree_environment not in BASE_URLS:
            raise ProviderUnavailable("Invalid Cashfree environment")
        # Production traffic needs an explicit production application and credentials.
        if settings.cashfree_environment == "production" and not settings.is_production:
            raise ProviderUnavailable("Production Cashfree requires a production application")
        self.environment = settings.cashfree_environment
        self.account = settings.cashfree_client_id
        self.secret = settings.cashfree_client_secret
        self.base_url = BASE_URLS[self.environment]
        self.webhook_url = settings.cashfree_webhook_url

    def _request(self, method: str, path: str, *, payload=None, idempotency_key=None, missing_ok=False):
        headers = {"x-client-id": self.account, "x-client-secret": self.secret,
                   "x-api-version": API_VERSION, "Accept": "application/json"}
        if idempotency_key:
            headers["x-idempotency-key"] = idempotency_key
        try:
            with httpx.Client(base_url=self.base_url, timeout=12.0) as client:
                response = client.request(method, path, json=payload, headers=headers)
            if missing_ok and response.status_code == 404:
                return None
            if response.status_code >= 400:
                raise ProviderUnavailable(f"Cashfree request failed ({response.status_code})")
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderUnavailable("Cashfree is temporarily unavailable") from exc
        if not isinstance(body, (dict, list)):
            raise ProviderUnavailable("Invalid Cashfree response")
        return body

    @staticmethod
    def order_id(payment) -> str:
        return f"sp_{payment.id.hex}"

    def create_session(self, payment, *, phone: str, customer_id: str, return_url: str):
        if not phone.isdigit() or len(phone) != 10:
            raise ProviderUnavailable("A valid 10-digit phone number is required for Cashfree")
        if payment.amount_paise < 100:
            raise ProviderUnavailable("Cashfree payment must be at least ₹1")
        order_id = self.order_id(payment)
        body = self._request("POST", "/pg/orders", payload={
            "order_id": order_id, "order_amount": float(rupees(payment.amount_paise)), "order_currency": "INR",
            "customer_details": {"customer_id": customer_id, "customer_phone": phone},
            "order_meta": {"return_url": return_url, "notify_url": self.webhook_url},
        }, idempotency_key=str(payment.id))
        if not isinstance(body, dict):
            raise ProviderUnavailable("Invalid Cashfree order response")
        if body.get("order_id") != order_id or body.get("order_currency") != "INR" or amount_paise(body.get("order_amount")) != payment.amount_paise or not body.get("payment_session_id"):
            raise ProviderUnavailable("Cashfree order response did not match this checkout")
        return {"orderId": order_id, "paymentSessionId": body["payment_session_id"], "environment": self.environment}

    def recover_session(self, payment, *, missing_ok=False):
        body = self._request("GET", f"/pg/orders/{self.order_id(payment)}", missing_ok=missing_ok)
        if body is None:
            return None
        if not isinstance(body, dict):
            raise ProviderUnavailable("Invalid Cashfree order response")
        if body.get("order_id") != self.order_id(payment) or body.get("order_currency") != "INR" or amount_paise(body.get("order_amount")) != payment.amount_paise or not body.get("payment_session_id"):
            raise ProviderUnavailable("Cashfree order response did not match this checkout")
        return {"orderId": body["order_id"], "paymentSessionId": body["payment_session_id"], "environment": self.environment}

    def verify_payment(self, payment, *, expected_payment_id: str | None = None) -> VerifiedReceipt:
        if payment.provider_order_id != self.order_id(payment):
            raise ProviderUnavailable("Cashfree order binding is invalid")
        payments = self._request("GET", f"/pg/orders/{payment.provider_order_id}/payments")
        if not isinstance(payments, list):
            raise ProviderUnavailable("Invalid Cashfree payment response")
        for item in payments:
            if not isinstance(item, dict) or item.get("payment_status") != "SUCCESS":
                continue
            payment_id = str(item.get("cf_payment_id") or "")
            if expected_payment_id is not None and payment_id != expected_payment_id:
                continue
            if (not payment_id or item.get("order_id") != payment.provider_order_id
                    or item.get("payment_currency") != payment.currency
                    or amount_paise(item.get("payment_amount")) != payment.amount_paise):
                raise ProviderUnavailable("Cashfree payment evidence does not match this checkout")
            return VerifiedReceipt("cashfree", self.account, self.environment, payment_id,
                                   payment.id, payment.amount_paise, payment.currency, payment.provider_order_id)
        raise ProviderUnavailable("No verified successful Cashfree payment found")

    def verify_webhook(self, raw_body: bytes, timestamp: str | None, signature: str | None) -> None:
        if not timestamp or not signature or len(raw_body) > 1_000_000:
            raise ProviderUnavailable("Invalid Cashfree webhook")
        expected = base64.b64encode(hmac.new(self.secret.encode(), timestamp.encode() + raw_body, hashlib.sha256).digest()).decode()
        if not hmac.compare_digest(expected, signature):
            raise ProviderUnavailable("Invalid Cashfree webhook signature")

    def get_refund(self, order_id: str, refund_id: str, *, missing_ok=False):
        return self._request("GET", f"/pg/orders/{order_id}/refunds/{refund_id}", missing_ok=missing_ok)

    def create_refund(self, order_id: str, refund_id: str, amount: int, *, idempotency_key: str):
        body = self._request("POST", f"/pg/orders/{order_id}/refunds", payload={
            "refund_amount": float(rupees(amount)), "refund_id": refund_id,
            "refund_note": "SportPass approved registration refund", "refund_speed": "STANDARD",
        }, idempotency_key=idempotency_key)
        if isinstance(body, list) and len(body) == 1:
            body = body[0]
        if not isinstance(body, dict):
            raise ProviderUnavailable("Invalid Cashfree refund response")
        return body
