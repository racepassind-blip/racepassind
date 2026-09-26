"""Gmail delivery over HTTPS, using a server-held, send-only OAuth grant."""
from __future__ import annotations

import base64
from email.message import Message

import httpx

from app.config import get_settings


class GmailDeliveryError(Exception):
    def __init__(self, message: str, reason: str = "UNKNOWN_ERROR"):
        super().__init__(message)
        self.reason = reason


def gmail_api_configured() -> bool:
    settings = get_settings()
    return bool(settings.gmail_oauth_client_id and settings.gmail_oauth_client_secret and settings.gmail_oauth_refresh_token)


def _check_response(response: httpx.Response, *, token_request: bool = False) -> dict:
    # Never expose Google's raw response: it can include credentials or content.
    if response.is_success:
        try:
            data = response.json()
            if isinstance(data, dict):
                return data
        except ValueError:
            pass
        raise GmailDeliveryError("Gmail API returned an invalid response")
    if token_request or response.status_code == 401:
        raise GmailDeliveryError("Gmail authorization failed. Check the OAuth client credentials and authorize the sender again.", "AUTHENTICATION_FAILED")
    if response.status_code == 429:
        raise GmailDeliveryError("Gmail sending quota reached. Try again later.", "PROVIDER_LIMIT_REACHED")
    if response.status_code == 403:
        raise GmailDeliveryError("Gmail API denied access. Check that the API is enabled, gmail.send permission is granted, and the account has sending quota.", "AUTHENTICATION_FAILED")
    raise GmailDeliveryError(f"Gmail API could not send the email (HTTP {response.status_code}).")


def send_gmail_message(message: Message) -> None:
    settings = get_settings()
    if not gmail_api_configured():
        raise GmailDeliveryError("Gmail API is not configured. Set GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET and GMAIL_OAUTH_REFRESH_TOKEN.", "AUTHENTICATION_FAILED")
    try:
        with httpx.Client(timeout=8.0) as client:
            token = _check_response(client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.gmail_oauth_client_id,
                    "client_secret": settings.gmail_oauth_client_secret,
                    "refresh_token": settings.gmail_oauth_refresh_token,
                    "grant_type": "refresh_token",
                },
            ), token_request=True).get("access_token")
            if not isinstance(token, str) or not token:
                raise GmailDeliveryError("Google did not return an access token.", "AUTHENTICATION_FAILED")
            result = _check_response(client.post(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                headers={"Authorization": f"Bearer {token}"},
                json={"raw": base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")},
            ))
            if not result.get("id"):
                raise GmailDeliveryError("Gmail API did not confirm delivery. Check Sent mail before retrying.")
    except httpx.RequestError as exc:
        # Do not automatically retry a send: Google may have accepted it before
        # the connection failed, and retrying could deliver duplicate tickets.
        raise GmailDeliveryError("Could not reach Gmail API or delivery could not be confirmed. Check Sent mail before retrying.", "API_CONNECTION_FAILED") from exc
