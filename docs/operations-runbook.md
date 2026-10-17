# SportPass India operations runbook

Use this document when SportPass India is unavailable, slow, or a database recovery is needed.

## Current production safeguards

| Area | Current setup |
| --- | --- |
| Public website | `https://sportpassindia.com/` |
| API health | `https://api.sportpassindia.com/health` |
| API readiness | `https://api.sportpassindia.com/ready` |
| Uptime alerts | UptimeRobot HTTP monitors for the website and API, checked every 5 minutes with email alerts enabled |
| API hosting | Render Free web service |
| Database | Neon PostgreSQL |
| Backups | GitHub Actions uploads PostgreSQL dumps to Cloudflare R2 |
| Backup storage | Private R2 bucket: `sportpass-production-backups`, under `postgres/` |
| Backup retention | R2 removes objects under `postgres/` after 30 days |

## Uptime monitoring

Keep both UptimeRobot monitors enabled at a **5-minute** interval:

1. `SportPass India — Website` → `https://sportpassindia.com/`
2. `SportPass India — API` → `https://api.sportpassindia.com/health`

The API check intentionally keeps the Render Free service awake. Render spins down an idle Free web service after 15 minutes, so do not increase the monitor interval above 10 minutes. Five minutes is preferred because it gives a safer margin and does not materially change the Free-instance usage.

The API health endpoint accepts both `GET` and `HEAD`. This is required for the free monitor: a `405 Method Not Allowed` incident normally means Render has not yet deployed commit `f01e768` (or a later commit containing the same change).

## When an alert arrives

### Website monitor is down

1. Open `https://sportpassindia.com/` in a browser.
2. Open `https://api.sportpassindia.com/health` in a browser.
3. If the API is healthy but the website is not, check the frontend deployment and Cloudflare configuration.
4. If both are unavailable, check the API section below first and then Cloudflare's dashboard/status.

### API monitor is down

1. Open `https://api.sportpassindia.com/health`.
   - Expected response: `{"status":"ok"}` with HTTP 200.
2. Open `https://api.sportpassindia.com/ready`.
   - Expected response: `{"status":"ready"}` with HTTP 200.
3. In Render, check the service status, recent deploy, logs, and monthly included usage.
4. If `/health` works but `/ready` returns HTTP 503, the API is running but cannot reach Neon. Check Neon project status, connection settings, and database availability.
5. If UptimeRobot shows HTTP 405, wait for the latest Render deployment to finish. The free monitor sends a `HEAD` request, which `/health` supports from commit `f01e768` onward.

## Render Free plan notes

Render's Free web service is suitable for the current early stage, but it is not a production guarantee:

- It can restart at any time and has no scaling.
- It receives 750 Free instance hours per workspace each calendar month.
- The 5-minute API monitor keeps one service running continuously (about 720–744 hours/month). A second always-on Free service shares the same 750-hour allowance.
- If the allowance is exhausted, Render suspends Free web services until the next month.
- Upgrade the API service to a paid Render compute plan before paid events or when client activity becomes regular.

See Render's current policy: <https://render.com/docs/free>

## Automated database backups

Workflow: `.github/workflows/database-backup.yml` (`Production database backup`)

- Runs every 6 hours at `:17` UTC.
- Expected India times: approximately 5:47 AM, 11:47 AM, 5:47 PM, and 11:47 PM IST.
- A manual run is available in GitHub: **Actions → Production database backup → Run workflow**.
- Each successful run uploads two files:
  - `postgres/sportpass-<timestamp>.dump` — PostgreSQL custom-format backup
  - `postgres/sportpass-<timestamp>.dump.sha256` — checksum for integrity verification

Required GitHub repository secrets:

```text
NEON_DATABASE_URL_UNPOOLED
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ENDPOINT
R2_BUCKET
```

`NEON_DATABASE_URL_UNPOOLED` must be Neon’s **direct** connection string, without `-pooler` in the hostname. Never store secret values in this document, source control, screenshots, or chat.

## Restore test procedure

Test a restore at least once before the first paid event, then periodically. Never restore directly into the production branch.

1. In Neon, create a branch from `production` named `backup-restore-test`.
   - Set auto-delete to one day.
   - Choose **Branch data and schema**.
2. On the temporary branch, use **Connect** and turn **Connection pooling** off. Copy the branch's direct connection string privately.
3. Download one `.dump` backup from R2 to `~/Downloads`.
4. Install and start Docker Desktop if Docker is not installed.
5. In Terminal, enter the temporary branch URL privately:

   ```bash
   cd ~/Downloads
   read -s RESTORE_DATABASE_URL
   export RESTORE_DATABASE_URL
   ```

6. Restore the downloaded file. Replace only the filename:

   ```bash
   docker run --rm \
     --env RESTORE_DATABASE_URL \
     --volume "$PWD:/backup" \
     postgres:18-alpine \
     sh -ec 'pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error /backup/YOUR-BACKUP-FILE.dump'
   ```

7. Confirm the restore finished without errors and inspect the temporary branch data.
8. Delete the `backup-restore-test` branch after verification.

## Do not do these things

- Do not paste database URLs, R2 access keys, GitHub secrets, or API tokens into chat, documentation, or commits.
- Do not run `pg_restore` against the production Neon URL.
- Do not make the R2 backup bucket public.
- Do not remove the R2 30-day lifecycle rule or the default 7-day incomplete-upload rule.

## Security and abuse protection

### Cloudflare edge protection

Cloudflare is the public edge for `sportpassindia.com` and `api.sportpassindia.com`. The root, `www`, and `api` web records must remain **Proxied** (orange cloud). Email records, if added later, must remain **DNS only**.

Current Free-plan login rule:

- Rule: `POST` requests to `/api/v1/auth/login`.
- Characteristic: client IP.
- Threshold: 5 requests in 10 seconds.
- Action: Block.
- Duration: 10 seconds.

This rule is a first barrier against credential stuffing. If it blocks legitimate users, lower the sensitivity only after reviewing Cloudflare Security Events; do not remove protection without replacing it. Add equivalent rules for signup and password-reset endpoints when the Free-plan rule allowance permits, prioritising login first.

### Application security controls

The API also applies database-backed limits over a 10-minute window:

- Login: 10 attempts per email/IP and 30 per IP.
- Account registration: 5 attempts per email/IP and 20 per IP.
- Password-reset requests: 3 per email/IP and 10 per IP.
- Payment, confirmation, registration, claim, and check-in actions have separate limits.
- Rate-limited responses return HTTP 429 with `Retry-After`.

Deploy and verify the centralized client-IP helper before relying on IP-based limits. In production it validates Cloudflare's `CF-Connecting-IP`; it must not trust arbitrary forwarded headers in development or direct-origin traffic.

### Admin and incident response

Before inviting real organizers or processing live payments:

1. Set `ADMIN_MFA_ENABLED=true` and verify every admin account has MFA configured.
2. Confirm Cloudflare DNS remains Active and the web/API records are proxied.
3. Test `/health` and `/ready` after any DNS or security change.
4. Watch Cloudflare Security Events, Render logs, Neon connections, and API 429/5xx counts.
5. For an attack, preserve the incident time, request IDs, Cloudflare event IDs, affected paths, and Render logs; then tighten the Cloudflare rule and revoke suspicious sessions or credentials.

Never test with a large automated flood. Use a few controlled failed logins and confirm the request is blocked at Cloudflare while normal browsing and successful login still work.

## Slack operations and lead generation

Slack is the lightweight operations hub for SportPass. Keep these channels small and purposeful:

- `#sportpass-alerts` — private; automated API, backup, and deployment failures only.
- `#event-ops` — daily organizer operations and event-day coordination.
- `#product` — product bugs, screenshots, and improvement ideas.
- `#announcements` — important decisions and releases.
- `#event-<event-name>` — a temporary channel for each major active event.
- `#sales-leads` — lead tracking and sales follow-up.

Pin these links in `#event-ops`: the SportPass organizer dashboard, UptimeRobot, Render, Neon, GitHub Actions, Cloudflare R2, and this runbook.

### Alert handling

Once the Slack webhook is configured, send these messages to `#sportpass-alerts`:

- API errors and failed payment/webhook processing
- GitHub database-backup workflow failures
- Important deployment failures

Keep UptimeRobot email alerts enabled as a fallback. When an alert arrives:

1. Reply in a thread under the alert and write `Investigating — <your name>`.
2. Check `/health`, `/ready`, Render logs, and the relevant section of this runbook.
3. Reply in the same thread with the current status or fix.
4. Mark the final reply `Resolved` once the incident is closed.

### Daily operations routine

1. Open `#sportpass-alerts` and resolve any alert that does not have a clear owner.
2. Confirm both UptimeRobot monitors are green.
3. Review registrations, payment issues, and upcoming events in SportPass.
4. Review `#event-ops` for organizer or participant issues.
5. Post short follow-up items in `#event-ops` rather than keeping them only in memory.

### Event-day routine

For every major event, create `#event-<event-name>` and post the event date, venue, start time, organizer contacts, check-in link, event operations checklist, volunteer responsibilities, and escalation contact for payment, QR, or check-in failures. Use it for staff coordination only; never post full participant, payment, or credential details.

### Weekly operations routine

1. Confirm GitHub database backups have successful runs.
2. Confirm recent `.dump` and `.dump.sha256` files appear in R2.
3. Check Render's included usage; one always-awake API is close to the Free plan's monthly 750-hour allowance.
4. Review unresolved items in `#product`.
5. Add recurring problems to the SportPass product backlog.
6. Remove event-volunteer access from event-specific channels after each event.

### Payment and payout audit

Use the right screen for the question being answered:

- **Organizer → SportPass Credits** (`/organizer/credits`): credit balance, top-up requests and usage.
- **Organizer → Payments & Settlements** (`/organizer/payments`): the single home for collections, refunds and payout history across authorized events. Event/date/status filters and CSV export apply to collections; payable and payout balances cover all dates for the selected event(s). Direct UPI payments are excluded from platform-held balances. Old event-finance/refund links redirect here with the event selected. Refund actions remain available in the Refunds tab.
- **Admin → Cashfree ledger** (`/admin/cashfree`): one row per event registration, including participant, registration status, Cashfree order/payment IDs and refund details. Filter by event, checkout creation dates (inclusive Indian calendar dates), payment status and environment. Search by participant name, registration reference, order, payment or refund ID. Live payments are the default; sandbox data is excluded from live totals. CSV exports every matching registration across all pages; columns ending in `_paise` are integer paise and timestamps include the IST offset. This is the SportPass event-registration ledger, not an import of every Cashfree gateway attempt or bank settlement.
- **Admin → Organizer settlements:** record or review the bank/UPI transfer to the organizer. A paid transfer must include its bank or UPI reference.

When a payment is disputed or appears missing, search the Cashfree order ID, payment ID, or SportPass registration reference. Treat a payment as collected only when the audit row has a verified receipt/`Collected` status. A browser success page, an emailed screenshot, or a pending gateway response is not payment evidence.

Before recording an organizer payout, reconcile the SportPass payable amount with Cashfree's own bank-settlement report. SportPass currently records the payment, refund, and organizer-payout trail; it does not automatically import Cashfree settlement batches.

### Slack security

- Make `#sportpass-alerts` private.
- Install only Slack apps that are necessary and trusted.
- Never post passwords, API keys, database URLs, payment details, or full participant information.
- Invite event volunteers only to their specific event channel, then remove access after the event.

### Lead-generation routine

For the next 30 days, focus on one city and these organizer types:

- Running clubs and race organizers
- Cycling communities
- Trek organizers
- Badminton academies that run tournaments

Track leads in a Google Sheet:

```text
Organizer | Sport | City | Instagram/WhatsApp | Next event | Contacted | Follow-up date | Status
```

Each working day:

1. Add 10 relevant organizers to the sheet.
2. Send 10 personalised messages. Mention the organizer's actual club or event; do not send generic bulk messages.
3. Follow up with earlier contacts after three days.
4. Record every contact in `#sales-leads`:

   ```text
   [Organizer] — [Sport] — [City]
   Next event: [date]
   Status: contacted / follow-up / demo / pilot / won / lost
   ```

Suggested first message:

```text
Hi [Name], I saw your [event/club] and liked what you are building.

I run SportPass India, a simple tool for registrations, payments, participant updates, and QR check-in on event day.

For a few early organizers, I am personally helping set up their next event. Would you be open to a quick 10-minute demo this week?
```

Suggested three-day follow-up:

```text
Hi [Name], just following up. If you have an upcoming event, I can show you the full registration-to-check-in flow in 10 minutes.
```

Weekly target:

- 50 new organizer leads
- 30 personalised messages
- 10 follow-ups
- 3–5 demo calls
- 1 pilot event

The immediate goal is not paid ads. It is three successful organizer pilots, then testimonials, event-day photos, and short case studies that make the next sales conversation easier.
