# Admin bills

Open **Admin → Credits → Raise bill** (also available on the Credit ledger page).

1. Select the organizer and choose Credits supplied, Event service fee, or Other services.
2. Check the business/legal name, email, phone, business address, and client billing details. The most recently issued bill supplies the business defaults; issued bills keep their original details.
3. Enter quantities and rates in INR. For an event, **Use recorded event fee** loads actual Credit charges less existing Credit discounts and includes the approved registration count in the notes. Review these figures before issuing.
4. Select **Payment pending** only when the client still owes the amount. Select **Paid** for money already received, including fees covered by purchased Credits; enter the payment date and purchase/payment reference.
5. Review and issue. **Print / Save PDF** opens the browser print dialog; choose Save as PDF to download a copy for the client.

Bills have unique numbers, immutable issue details, and an audit record. Pending bills can be marked paid or cancelled with a reason. Paid/cancelled bills cannot be edited through this workflow. The bill register supports organizer filtering and pagination.

Issuing, paying, or cancelling a bill does not move Credits or money. A bill discount affects only that bill; it does not return Credits. The current format shows **GST not charged** and does not calculate tax. Documents are admin-only and are not automatically emailed or publicly shared.

## Deployment

Apply migration `0089_admin_bills` with `alembic upgrade head` from the backend deployment before using the feature. The checked-in Render blueprint already declares this as its pre-deploy command. Confirm the deployed service uses that configuration. Do not run a production migration using test settings.

## Verification

Backend tests use an isolated SQLite database:

```sh
DATABASE_URL=sqlite:///:memory: ENVIRONMENT=test STORAGE_MODE=local pytest -q backend/tests/test_admin_bills.py backend/tests/test_credit_service.py
```

Frontend checks (from `frontend`):

```sh
npm test -- src/test/AdminBills.test.tsx src/test/AdminCreditsDiscount.test.tsx
npm run build
PLAYWRIGHT_CHANNEL=chrome npx playwright test --config=playwright.mobile.config.ts e2e/mobile-admin-bills.spec.ts
```

Browser tests use synthetic, mocked API responses and do not create production bills.
