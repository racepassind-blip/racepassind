# Refund accounting and audit

## Registration refunds

- Cashfree refunds complete only after a verified provider SUCCESS response. Pending, rejected, or cancelled provider attempts do not reduce organizer payable.
- Direct UPI refunds are sent by the organizer, recorded with a UTR, and completed when the participant confirms receipt.
- Completed full refunds hide the QR and prevent both QR and registration-reference check-in, including repeat checkpoint scans. Existing check-in history is preserved.
- Completed partial refunds use `partially_refunded` payment status and retain admission. Partial refunds do not mean cancellation.
- The original collection remains intact. Refund rows carry the amount returned; the gateway ledger and settlement calculations derive their totals from those rows.

## Credits and manual records

Participant refunds do not automatically return organizer credit fees. Credit fees retain their existing treatment. Any authorized credit adjustment must be posted separately to the credit ledger; no zero-value reversal or duplicate collection is created.

New manual refunds linked to a paid Direct UPI registration are registration refunds. They preserve the original payment amounts, cannot exceed the amount paid, and participate in registration payment-state updates. Unlinked outside-platform records are audit-only and do not affect a SportPass collection, settlement, or credit balance. Previously recorded manual audit-only rows are not automatically reclassified.

## Finding and exporting refunds

Both organizer and admin refund screens filter by event and status, and by requested, sent, or completed date in IST. The CSV export uses the same filters across all pages. Exports over 10,000 records require narrower filters; they are never silently truncated. Amount columns are in paise, and timestamps include the time-zone offset. The export includes the registration reference, refund/provider references, original amount, requested/approved amount, and accounting/credit treatment.

Gateway collection filters still use checkout date; use the refund screen's sent or completed date for refund-period audits.

## Deployment

Migration `0084_refund_payment_status` corrects historical managed partial refunds previously labelled `refunded`. It does not rewrite payment collections, wallet balances, or manual audit-only records. Its downgrade deliberately does not restore incorrect financial statuses.

After deployment, verify a refund in both the refund details and gateway ledger, and check the organizer payable. Test actual provider transfers only through the approved payment workflow; local tests use mocked provider responses and isolated SQLite data.
