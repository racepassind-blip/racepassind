# Gmail API setup for SportPass

All test, registration, ticket, refund, broadcast and retry emails now use Gmail's HTTPS API. Existing sender settings, email logs and local email limits remain in place. No database migration or new Python dependency is needed. Gmail App Passwords are no longer used for delivery. Deploy the backend and frontend together after configuring the following secrets.

## One-time Google authorization

1. In [Google Cloud Console](https://console.cloud.google.com/apis/library/gmail.googleapis.com), select a project and enable the Gmail API.
2. Configure Google Auth Platform branding and audience. If the audience is External and publishing status is Testing, add the sending Gmail account as a test user. Testing grants for Gmail expire after **7 days**; for ongoing production use, configure production publishing and meet any verification requirements Google presents, then authorize again. Workspace Internal apps are an option only for eligible organizations.
3. Create a separate **Web application** OAuth client for mail delivery (do not replace SportPass's Google sign-in credentials). Add this exact authorized redirect URI: `https://developers.google.com/oauthplayground`.
4. Open [Google OAuth Playground](https://developers.google.com/oauthplayground). In the gear/settings panel, enable **Use your own OAuth credentials** and enter that client's ID and secret. Use server-side flow, offline access and consent prompting. Using Playground's default credentials produces short-lived authorization.
5. Request only `https://www.googleapis.com/auth/gmail.send`. Authorize using the Gmail account that will send SportPass email.
6. Exchange the authorization code for tokens. Copy the **refresh token**, not the temporary access token, directly into Render's secret environment settings. Do not commit these values or paste them into chat.

## Render backend environment

Set these on the existing `sportpass-api` service:

- `GMAIL_OAUTH_CLIENT_ID`: the mail OAuth client ID.
- `GMAIL_OAUTH_CLIENT_SECRET`: its client secret.
- `GMAIL_OAUTH_REFRESH_TOKEN`: the refresh token from that same client and sender account.

Save the variables and deploy the backend changes. Render Free can reach the HTTPS endpoints used here; upgrading for SMTP is unnecessary. This change does not change your instance plan (the repository blueprint independently specifies Starter).

In **Admin → Communication**, set the sender name and the authorized Gmail address (or its verified Gmail send-as alias), enable email and save. The configured indicator confirms only that all three environment variables exist. Send a test to your own inbox to verify authorization and delivery. Check that production sends retain HTML and PDF tickets.

The backend obtains a fresh access token before each send; it never returns OAuth secrets to the browser. It does not automatically retry uncertain sends, to avoid duplicates. A successful test is required to verify credentials; presence alone does not establish validity. Existing queued-email retry behavior is retained.

## Troubleshooting

- **Authorization failed:** verify the client and refresh token belong together; authorize again if the grant expired or was revoked.
- **Access denied:** check Gmail API enablement, the `gmail.send` scope, account policy and Gmail quota.
- **Connection / uncertain delivery:** check Sent mail before retrying.
- **Wrong sender:** authorize the correct account and update the saved sender address. Google controls which aliases may be used.

References: [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending), [OAuth token refresh](https://developers.google.com/identity/protocols/oauth2/web-server#offline), [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).
