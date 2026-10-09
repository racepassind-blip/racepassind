# Cashfree production review

## Implemented locally

- Pending Cashfree registrations do not trigger registration emails.
- Verified success queues one email per booking and recipient in the same
  transaction as ticket confirmation. Repeated callbacks reuse that intent.
- A provider-verified debit that cannot be fulfilled queues distinct customer
  and admin review alerts. It is not labelled a failed payment and does not
  issue a ticket. Admins must investigate before resolving the paid order.
- Delivery occurs in a recovery worker after payment commit. Capacity-limited notifications remain
  queued. An ambiguous interrupted send is held for review, not blindly retried.
- Queued registration delivery rebuilds the formatted email and ticket PDF.
- Emails use participant totals including fees, IST event times, and escaped
  HTML values. Each recipient receives only their own paid-entry tickets.
- Provider data includes order identifier, total, currency, booking-contact
  identifier, phone, name, email, and return/webhook URLs. No other form answers,
  ticket QR tokens, or card details are sent by this adapter.
- Status checks prioritize verified success, then pending; failed and dropped
  attempts can retry. Unknown states and expired orders cannot reopen payment.
- Admin → Refunds includes a payment-review queue, event/organizer/order search,
  resolved history, and the actor/reason/provider-status audit trail. Admins may
  retry fulfillment only with the original valid event/reservation, or choose a
  full refund. The original receipt is retained; the decision cannot switch later.
- Refund requests serialize on event/registration locks and a partial unique
  database index prevents multiple open/completed refunds per registration.
  Organizer approve/reject and Direct UPI sent/received actions also serialize.
- Cashfree refunds persist the initiating admin and timestamp before contacting
  the provider. Status transitions are audited separately from that authorization.
  Recovery is identified as a system action while retaining the original initiator.
  Historical attempts without stored initiators remain unknown, not fabricated.

## Recovery and operational acceptance

- An API-process recovery thread starts when Cashfree is configured. It checks
  outstanding payments, initiated refunds and confirmation logs, then waits 60
  seconds. A PostgreSQL transaction advisory lock elects one sweep across replicas.
  No new paid service is needed. Apply migration 0076 before deploying this version.
  The API must stay running;
  recovery cannot run while the host is asleep. Monitor sweep durations/rate limits.
- Provider identities are persisted before order/refund creation requests. A crash
  after provider acceptance does not make these attempts invisible to recovery.
- Queued email preparation, credentials and explicit quota rejections can retry.
  Missing confirmed PDFs prevent sending an empty-ticket message. Generic legacy
  email retries remain disabled; this worker handles Cashfree booking/refund intents.
- Browser return recovery still depends on sessionStorage. A closed/incognito
  session cannot recreate guest credentials. The return page warns against paying
  twice and directs the user to emailed tickets, their registrations or support.
  Cross-device checkout resumption is not implemented.
- Provider-confirmed expiry releases reservations. A verified missing provider
  order may release reservations after 30 minutes. Pending payments and provider
  outages never release stock. Late success after expiry is held for review.
- Initiated refunds are polled automatically, but never approved or initiated by
  the worker. Reconcile older bound checkouts under their original credentials.
  Audit legacy unbound orders before switching merchant accounts/environments.
- Payment confirmation cannot imply exactly-once Gmail delivery: a crash or
  timeout after provider acceptance requires checking Sent mail before resend.
- Refunds for unfulfilled bookings use a persisted decision and deterministic
  provider reference. They never create tickets or organizer payable entries.
  Pending/issue/success emails are queued transactionally; outdated review emails
  are suppressed. Refund status is visible on the original checkout return page.
- Migration 0076 fails safely if duplicate active/completed refunds already exist.
  Investigate those records before retrying; the migration does not delete or
  rewrite financial history. Apply preceding migrations 0074/0075 if outstanding.
- Local verification covers actual PostgreSQL races, migrations and immutable
  resolution history, mocked provider timeouts/recovery, audit attribution,
  authenticated/CSRF-protected admin APIs, and customer/admin UI behavior.
- Run real sandbox acceptance for successful, pending-to-success, failed retry,
  dropped retry, expired orders, duplicate webhooks, missing browser return,
  multiple entries, email attachment delivery, refunds and account-mode changes.
- Use separate test events; sandbox confirms tickets but intentionally does not
  post production organizer balances. Production ledger reconciliation still
  needs a controlled live acceptance payment after account activation.

Do not enable production keys based only on unit test results.

These changes are local, not a deployment confirmation. Deploy backend and frontend
together, then validate real Gmail delivery/PDF QR scanning, process restart
recovery and the above scenarios before switching to live credentials.

Cashfree documents [success-first, then pending payment-state precedence](https://www.cashfree.com/devstudio/preview/pg/seamless).
The browser return URL is never treated as evidence of payment.
