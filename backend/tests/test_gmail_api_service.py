import base64
from email import message_from_bytes
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.services import gmail_api_service as gmail
from app.services import communication_service, email_service


@pytest.fixture
def settings(monkeypatch):
    value = SimpleNamespace(gmail_oauth_client_id="client", gmail_oauth_client_secret="secret", gmail_oauth_refresh_token="refresh")
    monkeypatch.setattr(gmail, "get_settings", lambda: value)
    return value


def client_for(monkeypatch, handler):
    real_client = httpx.Client
    monkeypatch.setattr(gmail.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))


def test_refresh_and_send_preserves_unicode_html_and_pdf(settings, monkeypatch):
    calls = []
    def handle(request):
        calls.append(request)
        if len(calls) == 1:
            assert request.url == "https://oauth2.googleapis.com/token"
            assert b"grant_type=refresh_token" in request.content
            assert b"refresh_token=refresh" in request.content
            return httpx.Response(200, json={"access_token": "access"})
        assert request.url == "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
        assert request.headers["Authorization"] == "Bearer access"
        import json
        decoded = message_from_bytes(base64.urlsafe_b64decode(json.loads(request.content)["raw"]))
        parts = list(decoded.walk())
        assert any(part.get_content_type() == "text/html" for part in parts)
        pdf = next(part for part in parts if part.get_content_type() == "application/pdf")
        assert pdf.get_payload(decode=True) == b"%PDF-test"
        assert pdf.get_filename() == "ticket.pdf"
        return httpx.Response(200, json={"id": "message-id"})
    client_for(monkeypatch, handle)
    message = MIMEMultipart()
    message["Subject"] = "SportPass ₹100"
    message.attach(MIMEText("<p>Confirmed ₹100</p>", "html", "utf-8"))
    attachment = MIMEApplication(b"%PDF-test", _subtype="pdf")
    attachment.add_header("Content-Disposition", "attachment", filename="ticket.pdf")
    message.attach(attachment)
    gmail.send_gmail_message(message)
    assert len(calls) == 2


@pytest.mark.parametrize("status,reason", [(401, "AUTHENTICATION_FAILED"), (403, "AUTHENTICATION_FAILED"), (429, "PROVIDER_LIMIT_REACHED"), (500, "UNKNOWN_ERROR")])
def test_api_failures_are_safe_and_classified(settings, monkeypatch, status, reason):
    def handle(request):
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "access"})
        return httpx.Response(status, json={"error": "private-secret-content"})
    client_for(monkeypatch, handle)
    with pytest.raises(gmail.GmailDeliveryError) as error:
        gmail.send_gmail_message(MIMEText("hello"))
    assert error.value.reason == reason
    assert "private-secret-content" not in str(error.value)


def test_invalid_refresh_token_never_sends(settings, monkeypatch):
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(400, json={"error": "invalid_grant"})
    client_for(monkeypatch, handle)
    with pytest.raises(gmail.GmailDeliveryError, match="authorize the sender again"):
        gmail.send_gmail_message(MIMEText("hello"))
    assert len(calls) == 1


def test_missing_credentials_never_calls_network(settings, monkeypatch):
    settings.gmail_oauth_refresh_token = None
    def handle(request):
        pytest.fail("No network call expected")
    client_for(monkeypatch, handle)
    with pytest.raises(gmail.GmailDeliveryError, match="not configured"):
        gmail.send_gmail_message(MIMEText("hello"))


def test_uncertain_send_is_not_automatically_retried(settings, monkeypatch):
    calls = []
    def handle(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(200, json={"access_token": "access"})
        raise httpx.ReadTimeout("secret detail", request=request)
    client_for(monkeypatch, handle)
    with pytest.raises(gmail.GmailDeliveryError, match="Check Sent mail") as error:
        gmail.send_gmail_message(MIMEText("hello"))
    assert "secret detail" not in str(error.value)
    assert len(calls) == 2


def configured_db():
    db = MagicMock()
    db.scalar.return_value = SimpleNamespace(enabled=True, configuration={"sender_name": "SportPass", "gmail_address": "sender@gmail.com"})
    return db


def test_admin_test_uses_api_without_app_password(settings):
    db = configured_db()
    with patch.object(communication_service, "send_gmail_message") as send:
        assert communication_service.send_test_email(db, recipient_email="recipient@example.com")[0]
    assert send.call_args.args[0]["Subject"] == "SportPass Email Test"


def test_regular_delivery_logs_api_failure(settings, caplog):
    db = configured_db()
    with patch.object(email_service, "get_email_limit_status", return_value=(email_service.EmailLimitStatus.NORMAL, 0)), patch.object(email_service, "send_gmail_message", side_effect=gmail.GmailDeliveryError("Quota reached", "PROVIDER_LIMIT_REACHED")):
        result = email_service.send_email(db, recipient="recipient@example.com", subject="Ticket", body="Confirmed", email_type="TICKET")
    assert not result.success
    assert result.email_log.status == "failed"
    assert result.email_log.failure_reason == "PROVIDER_LIMIT_REACHED"
    assert "PROVIDER_LIMIT_REACHED" in caplog.text
    assert "recipient@example.com" not in caplog.text


def test_regular_delivery_preserves_attachments(settings):
    db = configured_db()
    with patch.object(email_service, "get_email_limit_status", return_value=(email_service.EmailLimitStatus.NORMAL, 0)), patch.object(email_service, "send_gmail_message") as send:
        result = email_service.send_email(db, recipient="recipient@example.com", subject="Ticket", body="Confirmed", html_body="<p>Confirmed</p>", attachments=[("ticket.pdf", b"%PDF-test")], email_type="TICKET")
    assert result.success
    assert result.email_log.status == "sent"
    assert any(part.get_filename() == "ticket.pdf" for part in send.call_args.args[0].walk())


def test_retry_uses_api_and_updates_existing_log(settings):
    db = configured_db()
    log = SimpleNamespace(recipient="recipient@example.com", subject="Delayed email", status="pending_limit", reference_type=None)
    with patch.object(email_service, "send_gmail_message") as send:
        result = email_service._deliver_existing_log(db, log)
    assert result.success
    assert log.status == "sent"
    assert send.call_count == 1
    db.add.assert_not_called()


def test_disabled_email_does_not_send(settings, caplog):
    db = configured_db()
    db.scalar.return_value.enabled = False
    with patch.object(email_service, "send_gmail_message") as send:
        result = email_service.send_email(db, recipient="recipient@example.com", subject="Ticket", body="Confirmed", email_type="TICKET")
    assert result.status == "SKIPPED_DISABLED"
    assert "Email configuration disabled" in caplog.text
    send.assert_not_called()


def test_missing_oauth_is_visible_without_exposing_credentials(settings, caplog):
    settings.gmail_oauth_refresh_token = None
    db = configured_db()
    with patch.object(email_service, "get_email_limit_status", return_value=(email_service.EmailLimitStatus.NORMAL, 0)), patch.object(email_service, "send_gmail_message") as send:
        result = email_service.send_email(db, recipient="recipient@example.com", subject="Ticket", body="Confirmed", email_type="TICKET")
    assert result.status == "FAILED"
    assert "gmail_oauth_configured=False" in caplog.text
    assert "secret" not in caplog.text
    assert "recipient@example.com" not in caplog.text
    send.assert_not_called()


def test_local_limit_does_not_send(settings):
    db = configured_db()
    with patch.object(email_service, "get_email_limit_status", return_value=(email_service.EmailLimitStatus.LIMIT_REACHED, 480)), patch.object(email_service, "send_gmail_message") as send:
        result = email_service.send_email(db, recipient="recipient@example.com", subject="Ticket", body="Confirmed", email_type="TICKET")
    assert result.status == "PENDING_LIMIT"
    send.assert_not_called()


@pytest.mark.parametrize("key,reason,expected", [
    ("errors", "accessNotConfigured", "API_NOT_ENABLED"),
    ("details", "SERVICE_DISABLED", "API_NOT_ENABLED"),
    ("errors", "insufficientPermissions", "AUTHENTICATION_FAILED"),
    ("details", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "AUTHENTICATION_FAILED"),
    ("errors", "userRateLimitExceeded", "PROVIDER_LIMIT_REACHED"),
    ("errors", "domainPolicy", "AUTHENTICATION_FAILED"),
])
def test_specific_403_reason_without_exposing_provider_message(key, reason, expected):
    response = httpx.Response(403, json={"error": {"message": "private-content", key: [{"reason": reason}]}})
    with pytest.raises(gmail.GmailDeliveryError) as error:
        gmail._check_response(response)
    assert error.value.reason == expected
    assert "private-content" not in str(error.value)
    assert "denied access" not in str(error.value)
