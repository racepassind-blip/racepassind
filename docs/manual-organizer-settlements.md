# Manual organizer settlement ledger

## Source of truth

Only verified, confirmed production Cashfree platform checkout receipts create
ledger collections. Each registration receives a frozen allocation of the paid
amount, platform fee, organizer payable and participant count. Payment status
flags alone, sandbox payments, split payments and Direct UPI receipts do not
create platform-held funds. Historical amounts do not change when registration
details, prices or the event's payment mode change.

Counts are derived from these registration allocations; registration count and
participant count are separate. They are not an editable multiplier for money.
Admin corrections use signed, reasoned adjustments rather than changing the
underlying collection history.

## Balance calculation

All amounts are integer paise.

```text
Gross payable = sum of frozen organizer payable allocations
Refund deduction = completed managed refunds less refunded platform fees
Net paid = recorded paid transfers less linked settlement reversals
Outstanding = gross payable - refund deduction + payable adjustments - net paid
Available to settle = max(0, outstanding - pending transfers)
Recoverable from organizer = max(0, -outstanding)
```

Negative outstanding is displayed, not hidden. Pending reservations exceeding
the remaining outstanding balance are flagged and cannot be marked paid until
resolved. Cancelling or failing a pending record remains possible.

## Admin procedure

1. Search the event/organizer directory and open the specific event ledger.
2. Review verified collections, refunds, corrections, previous transfers,
   pending reservations and available balance.
3. Create a pending record before making a manual bank/UPI transfer. Confirm
   recipient details independently; this ledger does not send money.
4. After verifying bank success, update the pending record with the actual
   transfer reference and mark it paid. A paid reference is mandatory and unique.
5. Mark unsuccessful/cancelled pending transfers accordingly. If the bank outcome
   is uncertain, reconcile it before creating another transfer.
6. Correct a paid record with a linked reversal and a reason, then record any
   required replacement accurately. A reversal changes bookkeeping only; it does
   not recover money from the recipient. Never reverse a genuine transfer merely
   to release more payable balance.
7. Use signed payable adjustments for justified balance corrections, not as a
   substitute for verified collections or missing bank reconciliation.

Paid records, collection allocations and adjustments are immutable. History
retains reasons, actor and timestamps. Pending edits require the current version
and event identity. Submission retries reuse the same request key; duplicate
references are also rejected. Event-level database locks serialize financial
writes and refund completion. Events with managed financial history must remain
archived rather than permanently deleted.

## Rollout and verification

Migration `0068_organizer_settlement_ledger.py` creates the ledger tables,
constraints and PostgreSQL immutability/refund-locking triggers. It refuses a
destructive downgrade if ledger rows exist. It was tested on a disposable local
PostgreSQL instance, not applied to the remote database.

Before production rollout, take a backup, rehearse the migration against a
production-like staging database, and reconcile representative registrations,
refunds and bank transfers end-to-end. Existing receipts are not automatically
backfilled; historical import requires verified receipt-to-registration evidence
and reconciliation. Do not manufacture ledger collections from legacy statuses.
Cashfree checkout and refund adapter code is now present; see
`cashfree-integration.md`. Sandbox credentials and a reachable webhook endpoint
are still required for provider acceptance testing. No remote migration has run.

Validation on 2026-10-07: backend suite ran 177 tests (six skipped), frontend
suite passed 78 tests, TypeScript checking and production build passed. Tests
cover concurrent overspending, duplicate requests, refund-versus-payout changes,
stale edits, cross-event isolation, reversals, immutable history, API authorization
and CSRF, and frontend retry/event switching. Build still reports a large-bundle
warning. Automated checks do not guarantee bank reconciliation or eliminate
operational error; manual verification remains required.
