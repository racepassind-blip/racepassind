# Cashfree PG integration status

The registration checkout now has a Cashfree platform collection path. A server
created order provides a payment session to Cashfree Checkout. A signed webhook
or a participant status check causes the server to fetch Cashfree payment records.
Only an exact successful payment for the bound order, amount, currency, account
and environment confirms tickets. Production confirmations post frozen organizer
ledger collections. Sandbox receipts confirm sandbox registrations but do not
create production settlement balances.

This work has not been run with a Cashfree account. No remote database was
migrated and no live credentials or money were used. Keep `CASHFREE_ENABLED=false`
until migration 0067 and 0068 are applied and sandbox testing is complete.

## Configuration

Set these server environment variables in the target environment:

```text
CASHFREE_ENABLED=true
CASHFREE_ENVIRONMENT=sandbox
CASHFREE_ALLOW_SANDBOX_IN_PRODUCTION=false
CASHFREE_CLIENT_ID=<sandbox app ID>
CASHFREE_CLIENT_SECRET=<sandbox secret>
CASHFREE_WEBHOOK_URL=https://<public backend>/api/v1/webhooks/cashfree
FRONTEND_ORIGINS=https://<staging frontend>
```

Configure Cashfree PG webhook delivery to the same HTTPS URL, with payment
success events enabled. The server includes it as `order_meta.notify_url` for
each order. Use separate production credentials and
`CASHFREE_ENVIRONMENT=production` only with a production application. Secrets
belong in the deployment secret store, never the repository or browser.

For a temporary pre-launch test on the production-hosted service, keep
`ENVIRONMENT=production` and explicitly set
`CASHFREE_ALLOW_SANDBOX_IN_PRODUCTION=true`. This override permits only the
Cashfree sandbox. Remove it after acceptance testing.

When configured, organizers can choose Cashfree Managed for paid events. A
10-digit participant phone is required for a paid gateway registration. The
checkout returns from Cashfree to the event checkout page and rechecks payment
status on the server. A closed browser can still be confirmed by the webhook.
The confirmation page fetches current registration state before showing tickets.

## Refund procedure

An organizer reviews a refund request using the existing approval flow. An
admin then opens the refund in `/admin/refunds` and issues the approved Cashfree
refund. Cashfree may return a pending status. The admin checks the Cashfree
status there until it reaches `SUCCESS`; only then does the refund reduce the
organizer payable balance. The request ID and provider refund ID are stable on
retries. Cancellation, rejection or a long pending state needs admin review.
Provider refund status polling is currently operator driven; a scheduled worker
and refund webhook handling are still needed before unattended operation.

## Sandbox acceptance gate

1. Apply migrations 0067 and 0068 to isolated staging, after a backup.
2. Configure sandbox keys, public HTTPS webhook, and the staging frontend origin.
3. Create a managed event, pay a single entry and a multi-entry order in sandbox.
   Verify exactly one ticket confirmation per entry and no production ledger
   collection from sandbox receipts.
4. Repeat payment callbacks and browser status checks; ticket counts must remain
   unchanged. Try wrong order IDs, amounts and signatures; none may confirm.
5. Approve and issue a sandbox refund; verify pending leaves the ledger alone
   and provider `SUCCESS` updates refund status once.
6. Reconcile Cashfree dashboard orders, payments and refunds against SportPass
   records before any production activation. Test late payments and closed events
   as `paid_needs_review` cases.

The local suites validate the adapter using simulated provider replies. They do
not verify Cashfree account permissions, actual webhook delivery, dashboard
configuration, settlement timing or bank transfers. Manual organizer settlement
remains a separate admin action after production collection.

Implementation follows Cashfree's [web checkout setup](https://www.cashfree.com/devstudio/preview/pg/web/checkout),
[webhook signature guidance](https://www.cashfree.com/devstudio/preview/pg/tools/webhookVerification),
[Create Refund](https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create-refund)
and [Get Refund](https://www.cashfree.com/docs/api-reference/payments/latest/refunds/get-refund).
