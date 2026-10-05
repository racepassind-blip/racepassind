# Shared payment foundation — implementation status

Implemented locally on 2026-10-01. This is a credential-free foundation, not a
completed Cashfree integration. Nothing has been deployed or migrated remotely.

## Implemented

- Shared payment identity for merchandise orders and event orders. A batch of
  event registrations shares one aggregate payment; existing participant payment
  records remain for compatibility.
- Immutable amount/fee/mode snapshots in integer paise, with separate payment
  and settlement status. Direct UPI and manual offline retain existing credit
  charging. Future gateway modes model fee withholding instead.
- Direct UPI creation, reference submission and organizer decisions synchronize
  the shared records. Existing orders acquire records lazily at these entry
  points; this is not a complete historical backfill or refund ledger.
- Separate disabled adapters for the common Cashfree contract, usable for both
  SportPass settlement and split settlement. No keys, mock success endpoints,
  public gateway mode selection or live network calls have been added.
- Internal server-side reconciliation seam validates provider account,
  environment, bound provider order, payment identity, exact amount and currency.
  A unique receipt deduplicates callbacks; a second successful payment is recorded
  as a duplicate without repeating fulfillment.
- Domain finalization runs in a savepoint. Late/unfulfillable money is retained
  as `paid_needs_review`; a raised exception rolls back effects for retry.
  Payment success does not imply settlement or refund success.
- Merchandise checkout reuses its request key and access token for unchanged
  retries while mounted, and rejects changed payloads against new recorded keys.
  This is not refresh/redirect recovery. Legacy records without a fingerprint
  cannot provide the same changed-payload check.
- Terminal merchandise orders are archived, not destroyed. The existing DELETE
  endpoint remains compatible but hides the order from the organizer list while
  retaining payment history, access hashes and request keys.

## Transaction/security contract

`checkout_payments.py` is internal, not an authorization boundary. Callers must
authorize access and own the transaction. Mode, amount, fees and verified vendor
mapping must come from server-controlled configuration, never the browser.

For future gateway reconciliation, use a trusted adapter that verifies successful
payment status against Cashfree. Never construct `VerifiedReceipt` from browser
parameters or an unverified webhook. Bind provider orders from server-created or
server-recovered results. Acquire domain/inventory locks through `lock_owner`
before the shared payment lock. The finalizer must recheck expiry, cancellation,
capacity and inventory, and atomically apply tickets/stock/fees without sending
email or committing. It must return false when fulfillment is unsafe. Commit the
receipt and domain changes together. Handle uniqueness races with transaction
rollback/retry. External notifications require a transactional outbox later.

The schema and tests enforce useful invariants, but do not establish that the
system is invulnerable or that PostgreSQL concurrency has been validated.

## Still required before sandbox / live

1. Real Cashfree order/session creation and verification adapter, stable provider
   idempotency, timeout recovery and safe provider-error handling.
2. Signature-verified raw-body webhook ingress, durable inbox, retry worker and
   reconciliation polling. Browser redirects must never mark orders paid.
3. Domain finalizers for gateway event/merchandise payments, with integration
   tests for stock, capacity, cancellation, concurrent retries and fee accounting.
4. Organizer/vendor onboarding and verification, category-specific minimal KYC,
   approved vendor mappings and server-controlled payment-mode enablement.
5. Easy Split instructions, verified settlement tracking, refunds, reversals,
   reconciliation and operational review tools. `pending` settlement is only a
   placeholder today; no automatic payout is performed.
6. Redirect/refresh-safe checkout recovery, customer-facing gateway UI and
   notification outbox respecting the existing merchandise email policy.
7. Sandbox credentials and account access, then sandbox acceptance tests. Live
   requires Cashfree product/account approvals, production-only configuration,
   monitoring and a controlled rollout. Adding credentials alone is insufficient.

See `payment-platform-implementation-plan.md` and
`cashfree-vendor-onboarding.md` for the broader design and onboarding checklist.

## Migration and verification

Migration `0067_checkout_payments` follows `0066_product_sales`. Apply it before
running this application version in a target environment. Back up and rehearse
on an isolated copy first. Downgrade intentionally refuses to drop populated
financial records; use a forward fix or disable checkout instead.

The backend suite was run against isolated SQLite with the current ORM schema
and Alembic head stamped: 142 tests, 6 skipped. Migration 0067 is tested separately
for upgrade and empty downgrade. A full historical migration-chain run on fresh
SQLite encountered a pre-existing duplicate `email_logs.event_id` column error;
that chain and PostgreSQL deployment/concurrency remain to be verified. No remote
database was migrated for this work.
