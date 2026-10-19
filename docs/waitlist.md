# Event waiting lists

Organizers enable the waiting list per event and configure its hard participant limit. Joining is free and only available when the chosen ticket or the event is full. The participant receives a queue number and an email. Pending registrations and outstanding invitations count toward capacity.

The organizer dashboard invites the first waiting participant when capacity exists. Invitations charge the normal checkout price by default; the organizer can explicitly waive all payment, including extras. Each invitation reserves one single-participant ticket for 30 minutes. Its private email link opens the existing checkout, where required participant fields and waivers remain mandatory.

The 30-minute deadline applies to claiming the invitation. Unclaimed offers expire and the worker offers the next participant a place at the normal price. Once checkout creates a registration, the existing payment lifecycle owns the reservation: Direct UPI requires organizer review, while Cashfree follows provider reconciliation. Do not automatically release a Direct UPI place merely because a timer elapsed; money might already have been transferred.

Email delivery is queued, with persisted delivery flags and five-minute retries. The worker runs every 30 seconds and uses a PostgreSQL advisory lock to coordinate replicas. Configure the session signing secret, public frontend origin, and email provider before rollout. Secret rotation invalidates outstanding invitation links.

## Rollout and verification

- Apply migrations 0085 and 0086 before starting the updated application.
- Start the application with its background waitlist worker enabled through the normal application lifecycle.
- Verify join and invitation emails in staging, including the checkout link and correct public origin.
- Exercise normal-price Cashfree and Direct UPI flows with test accounts, plus waived checkout, expiry, duplicate requests, and organizer ownership.
- Run concurrent checkout/invitation tests against isolated PostgreSQL before production rollout. Local automated API/service tests use SQLite and cannot establish PostgreSQL locking behavior.

Automated coverage is in `backend/tests/test_waitlist.py` and `frontend/src/test/WaitlistFlow.test.tsx`. External email and payment effects are mocked. These tests are not evidence of live provider delivery or a complete browser-to-provider end-to-end test.
