# Motorcycle V1 — verification and release checklist

Verified locally on 2026-10-18. Not deployed or pushed by this task.

## Implemented

- Canonical `motorcycle` backend adapter and frontend sport configuration; no aliases.
- Adapter-driven numbering restriction enforced at allocation APIs and operational-feature updates. Existing sports retain their backend defaults.
- No motorcycle results or tournaments; existing capability gates are reused.
- Required-by-default motorcycle make/model and registration-number questions in individual and team builders. Organizers retain existing form-builder controls.
- Sport switching removes outgoing sport defaults, preserves unrelated questions, prevents duplicates and rejects custom-field overflow before updating either builder section.
- Meeting-point labels use sport metadata. Storage/API names remain `pickup_points` and `pickup_point_id`; selection remains optional unless configured required.
- Shared registration, payment, organizer filtering/export, manual registration and check-in services remain in use.
- Team CSV export includes section definitions and each member's custom answers, labelled with participant names. Single-participant cell formatting remains unchanged.
- Organizer team details show per-member custom answers. Public event output does not include submitted vehicle answers.

## Files

Backend:

- `backend/app/sports/{base,motorcycle,registry}.py`
- `backend/app/api/v1/{allocations,events}.py`
- `backend/app/services/{registration_config_service,registration_service}.py`
- `backend/tests/test_motorcycle_adapter.py`
- `backend/tests/test_motorcycle_workflows.py`

Frontend:

- `frontend/src/sports/{types,motorcycle}.ts`
- `frontend/src/data/sportConfig.ts`
- `frontend/src/lib/sportRegistrationFields.ts`
- `frontend/src/pages/{OrganizerEventCreate,Checkout,OrganizerManualParticipant,OrganizerRegistrations}.tsx`
- `frontend/src/test/{motorcycleSportConfig,sportRegistrationFields}.test.ts`
- `frontend/src/pages/OrganizerEventAnnouncements.tsx`: one-line correction from nonexistent event `title` to `name`, clearing the pre-existing type-check failure.

## Actual checks

| Command | Result |
| --- | --- |
| Backend: `DATABASE_URL=sqlite:///:memory: ENVIRONMENT=test STORAGE_MODE=local pytest -q` | 503 passed, 20 skipped, 27 subtests passed |
| Frontend: `npm test` | 124 passed, 27 files |
| Frontend: `npx tsc --noEmit -p tsconfig.app.json` | Passed |
| Frontend: `npm run lint` | Zero errors; 20 existing warnings |
| Frontend: `npm run build` | Passed; large-bundle warning remains |
| `git diff --check` | Passed |

Motorcycle tests cover database persistence, required rider answers, optional/required/invalid meeting choices, team member validation and CSV export, organizer isolation, public event response privacy, free and Direct UPI registration, manual entry, QR/reference check-in, and capability rejection. Existing Cashfree integration tests also run against a motorcycle event (mock provider), including confirmation, ledger, retries, signed webhooks and refunds. Full regression suites include trekking and the existing sports/shared workflows.

No schema migration, new table, payment provider implementation or API-field rename. API behavior intentionally changes for motorcycle: allocation operations and attempts to enable bibs return 422; allocation configuration returns `number_enabled: false`. No production database was accessed. Local SQLite tests do not replace PostgreSQL-specific verification; skipped tests are not counted as passed.

## Before production rollout

1. Deploy backend and frontend together to staging; run CI, including PostgreSQL integration tests against an isolated test database.
2. Create an individual and a team motorcycle event through the actual UI; check rider fields and optional/required meeting choices on mobile.
3. Complete free, Direct UPI and Cashfree sandbox registrations. Confirm callback/webhook behavior and persisted answers after reload; no real charges are needed for this smoke test.
4. Check authorized organizer details, meeting filters and CSV for every team rider. Confirm another organizer cannot access them.
5. Scan a ticket with a physical phone and use manual reference check-in; confirm duplicate scans are handled.
6. Confirm bib, results and tournament tools are absent; smoke-test an existing trekking/running event.

These deployment/browser/provider checks were not performed in this task. Passing local tests is not a claim that the deployed service has been validated.
