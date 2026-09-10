# RacePass India POC — Implementation Tasks

**Requirements:** `requirements.md`  
**Design:** `design.md`  
**Status:** Ready for implementation

## Working rules

- Execute tasks in order unless a dependency explicitly allows parallel work.
- Complete one vertical slice at a time and keep the app runnable after each slice.
- Do not mark a task complete until its functional behavior, authorization, validation, privacy, failure handling, concurrency behavior, audit behavior, and tests are addressed.
- Never add card collection or merchant payment behavior to this POC.
- Never use frontend route guards as a security control.
- Never commit secrets, demo production passwords, local databases, or uploaded participant data.

## Phase 0 — Safe baseline

### T001 — ✅ Complete: Capture baseline and local runbook

**Depends on:** none  
**Outcome:** The current app can be run and its baseline behavior is recorded before refactoring.

- Record current frontend/backend commands and ports.
- Run the existing frontend build/lint and backend import/health smoke checks where available.
- Record the existing API routes and current database migration head.
- Confirm the working tree before code changes; do not overwrite unrelated user work.
- Add a short developer runbook if the repository lacks one.

**Security/scale checks:** no secrets in logs; local SQLite clearly marked development-only; baseline does not claim mocked flows are production-ready.

### T002 — ✅ Complete: Add backend configuration and modular package boundary

**Depends on:** T001  
**Outcome:** Backend settings are environment-driven and new code can be added without putting business logic in `main.py`.

- Add typed settings for environment, database URL, frontend origins, session/CSRF secrets, OAuth, storage, container port, and migration behavior.
- Keep settings names provider-neutral; deployment providers may supply values, but application code must not require provider-specific APIs or SDKs.
- Create the `app/` module boundaries from `design.md` while preserving a temporary compatibility entry point.
- Define infrastructure interfaces for storage and external identity, with provider-specific implementations isolated outside domain/services.
- Make production fail closed when required secrets/origins are missing.
- Add structured request IDs and safe exception handling.
- Confirm the backend can run under the documented Docker-compatible process contract without persistent container-local state.

**Tests:** settings validation; production rejects missing secrets; errors do not expose stack traces or secrets; provider-neutral settings load from environment variables; service modules do not import hosting/provider SDKs; container startup contract is documented and smoke-tested.

### T003 — ✅ Complete: Establish PostgreSQL-compatible migration baseline

**Depends on:** T002  
**Outcome:** The schema can migrate deterministically on PostgreSQL while SQLite remains a local option only.

- Add/adjust SQLAlchemy models and Alembic migration for explicit INR paise fields, ownership, sessions, audit records, payment settings, references, tokens, and reservation fields.
- Preserve existing data where possible; do not use destructive `drop_table` behavior for production migrations.
- Add indexes and unique constraints from `design.md` using standard PostgreSQL-compatible behavior.
- Validate the production migration path against standard PostgreSQL; keep SQLite-specific behavior limited to the documented local-development compatibility path.
- Make production startup independent of automatic migrations.

**Tests:** migration up/down on a disposable database; PostgreSQL integration migration against standard PostgreSQL; constraint tests; no provider-specific database API is required.

## Phase 1 — Identity and organization boundaries

### T004 — ✅ Complete: Implement backend sessions and email/password authentication

**Depends on:** T003  
**Outcome:** Users can register/sign in/sign out through secure backend sessions.

- Add password hashing, session token hashing, expiry, revocation, and `/auth/me`.
- Use HTTP-only secure cookies and CSRF protection for mutations.
- Normalize emails; prevent account enumeration; rate-limit login/registration.
- Seed a development-only admin through an explicit local command, never through production startup.

**Tests:** valid/invalid login, expired/revoked session, password hash behavior, CSRF failure, rate-limit behavior, no sensitive logs.

### T005 — Implement Google OAuth adapter

**Depends on:** T004  
**Outcome:** Google sign-in uses a backend-controlled authorization-code flow.

- Add state and PKCE storage/validation.
- Validate issuer, audience, expiry, and email claims.
- Never grant organizer/admin role from Google identity alone.
- Configure local/preview/production redirect URLs through environment variables.

**Tests:** state mismatch, callback replay, invalid claims, account link behavior, role safety. Requires developer-provided Google OAuth credentials for live smoke testing.

### T006 — ✅ Complete: Implement organizations, membership, roles, and admin onboarding

**Depends on:** T004  
**Outcome:** Admin can onboard organizers and backend ownership checks are reusable.

- Add organization membership and explicit organizer/admin dependencies.
- Add organizer activation/deactivation.
- Add reusable event/registration ownership checks.
- Ensure inactive organizers cannot mutate or publish events.

**Tests:** admin onboarding; participant denial; organizer A cannot access organizer B; deactivated account denial.

## Phase 2 — Event catalog vertical slice

### T007 — ✅ Complete: Implement event, race category, ticket-tier, and manual UPI APIs

**Depends on:** T003, T006  
**Outcome:** An organizer can securely prepare an event for publication.

- Add event draft/published status and Indian event fields.
- Add race categories/distances and ticket tiers.
- Use integer INR paise; validate price, capacity, sale window, and category ownership.
- Add UPI ID, payee name, instructions, and QR image reference fields.
- Keep mutations organizer-scoped and auditable.

**Tests:** invalid dates/prices/capacities; ownership denial; publish validation; safe public response fields; audit records.

### T008 — ✅ Complete: Replace European seed data with Indian development seed

**Depends on:** T007  
**Outcome:** Local/demo environments show realistic Indian running and cycling events.

- Add explicit idempotent development seed command.
- Use INR paise and category/ticket hierarchy.
- Do not seed demo passwords in production.
- Ensure repeated seed execution does not duplicate events or organizers.

**Tests:** repeatability, safe environment guard, correct currency and availability.

### T009 — ✅ Complete: Connect public Explore and event detail UI to the API

**Depends on:** T007, T008  
**Outcome:** Visitors can browse published Indian events with safe, paginated data.

- Replace the current event hook contract with versioned API responses.
- Add search/filter/pagination behavior.
- Remove assumptions that one event has one distance.
- Display INR consistently and show registration availability/status.

**Tests:** loading/error/empty states; unpublished events hidden; response does not include participant/payment data; frontend build/lint.

### T010 — Build organizer event setup UI

**Depends on:** T007, T009  
**Outcome:** An organizer can create categories, tickets, UPI settings, save draft, and publish.

- Replace the current one-distance event form with an event/category/tier workflow.
- Include UPI ID, payee name, instructions, and generated/uploaded QR configuration.
- Remove fake revenue/registration assumptions from organizer dashboard.
- Show validation and server errors without leaking backend details.

**Tests:** organizer-only access; form validation; failed save does not display success; publish only when requirements pass.

## Phase 3 — Registration and manual payment vertical slice

### T011 — ✅ Complete: Implement transactional single-registration creation

**Depends on:** T007, T003  
**Outcome:** A guest can create exactly one durable registration for one participant and one ticket.

- Enforce quantity `1` server-side.
- Lock ticket inventory, validate sale window, create reservation, participant snapshot, registration, order, and pending manual payment.
- Calculate amount from the database ticket price in paise.
- Generate hashed confirmation and claim credentials.
- Support idempotency keys and safe retries.
- Return only the minimum guest confirmation data.

**Tests:** tampered price/amount; invalid ticket/category; sold out; closed window; duplicate idempotency key; concurrent registrations; no oversell; no sensitive response leakage.

### T012 — ✅ Complete: Build guest registration UI

**Depends on:** T011, T009  
**Outcome:** A runner can register without an account.

- Collect participant name, required race fields, and at least email or phone.
- Remove card number, expiry, and CVV fields entirely.
- Prevent quantity selection beyond one.
- Preserve the opaque confirmation credential without localStorage secrets.
- Show registration reference and pending status.

**Tests:** client validation is not the only validation; API failure; refresh/retry; mobile layout; no card data handling.

### T013 — ✅ Complete: Implement manual UPI display and payment-reference update

**Depends on:** T011, T010  
**Outcome:** The runner sees the organizer's UPI information and can optionally submit a UTR/reference.

- Generate a validated UPI payment URI and QR from server data.
- Display organizer-uploaded QR when configured.
- Add authenticated/credentialed pending-registration reference update.
- Rate-limit updates and audit UTR submissions.
- Explain that UTR is supporting evidence, not automatic payment proof.

**Tests:** amount cannot be changed in the browser; invalid UPI/reference; expired registration; unauthorized update; duplicate update behavior; no UTR in public event responses.

### T014 — ✅ Complete: Implement organizer payment approval/rejection

**Depends on:** T006, T011, T013  
**Outcome:** Organizer/admin can safely decide a manual payment.

- Add scoped pending-registration list.
- Implement approve/reject transitions with reason.
- Use row locks and idempotent transitions.
- Convert reservation to sold inventory exactly once on approval; release on rejection/expiry.
- Write audit events for each decision.

**Tests:** organizer ownership; admin support; invalid transitions; duplicate approval; concurrent approval; rejection releases reservation; safe error responses.

### T015 — ✅ Complete: Implement durable confirmation and QR ticket

**Depends on:** T011, T014  
**Outcome:** A runner has a reloadable confirmation and confirmed registrations have a safe QR ticket.

- Add confirmation endpoint using opaque credential or authenticated access.
- Render pending/rejected/confirmed states from backend data.
- Generate a random non-sensitive ticket token only on approval.
- Do not put PII, UTR, or secrets into the QR payload.

**Tests:** credential replay policy; invalid token; token not guessable; rejected registration has no active ticket; QR token resolves only to authorized event data.

## Phase 4 — Accounts and organizer operations

### T016 — ✅ Complete: Implement secure guest registration linking

**Depends on:** T004, T005, T011, T015  
**Outcome:** Authenticated participants can see eligible matching guest registrations and use claim-code fallback.

- Normalize email/phone consistently.
- Auto-match only verified email/Google email where allowed.
- Require reference + claim code for unverified/ambiguous contact matches.
- Link in one transaction and prevent a second account from claiming.
- Add privacy-safe participant registration responses.

**Tests:** exact match; non-match; another account denied; invalid/expired claim; already claimed; phone match not treated as proof without verification.

### T017 — ✅ Complete: Replace dummy AuthContext and participant dashboard

**Depends on:** T004, T009, T015, T016  
**Outcome:** Frontend auth and My Registrations use backend records.

- Bootstrap `/auth/me`; remove hard-coded credentials and localStorage user objects.
- Add email/password and Google buttons.
- Add claim/matching UI.
- Replace fabricated upcoming/past tickets with API data.
- Handle session expiry and logout.

**Tests:** auth loading/error; session expiry; role redirects; no protected data rendered before auth; dashboard API states.

### T018 — ✅ Complete: Implement organizer registration management and CSV export

**Depends on:** T014, T017  
**Outcome:** Organizer sees only their event registrations and can export allowed fields.

- Add paginated/filterable registration API and UI.
- Add server-generated CSV with ownership checks and data minimization.
- Remove ten-row fabricated registration data.
- Show payment and registration state clearly.

**Tests:** cross-organizer denial; filter authorization; CSV fields; pagination; large export boundary; no secret/token columns.

### T019 — ✅ Complete: Implement QR/reference check-in

**Depends on:** T015, T018  
**Outcome:** Organizer can check in a confirmed participant once.

- Scan/submit QR token or registration reference.
- Confirm event ownership and registration status.
- Make check-in idempotent and record actor/time/device metadata safely.
- Add participant-facing checked-in state where appropriate.

**Tests:** invalid token; wrong organizer; rejected/unconfirmed registration; duplicate check-in; concurrent check-in; audit record.

### T020 — ✅ Complete: Implement admin fee configuration

**Depends on:** T006, T018  
**Outcome:** Admin can configure a fixed or percentage fee per organizer, defaulting to zero.

- Add admin UI/API for `none`, fixed-per-registration, and percentage.
- Store configuration without deducting or settling money.
- Restrict visibility and mutation to admins.
- Add future-proof response fields without changing participant totals.

**Tests:** admin-only access; organizer cannot view/edit another organizer's fee; zero default; invalid percentage/fixed values.

## Phase 5 — Production hardening and launch

### T021 — ✅ Complete: Add object storage for organizer QR images

**Depends on:** T010, T013  
**Outcome:** QR image upload works without relying on backend local disk.

- Implement the provider-neutral storage interface and an S3-compatible production adapter plus a local-development adapter.
- Configure endpoint, bucket, region, and credentials only through typed environment settings; never expose storage credentials to the frontend.
- Keep private bucket/signed URL behavior inside the adapter and storage service boundary.
- Validate MIME type, extension, size, and dimensions.
- Clean up replaced/unused objects safely and make removal idempotent.
- Keep generated QR independent of storage.
- Verify domain and service modules do not import a provider-specific storage SDK.
- Keep the backend Docker-compatible and free of required persistent local-disk state.

**Tests:** protocol-compatible fake/local adapter; invalid file; oversized file; unauthorized upload; signed URL expiry; missing object; idempotent removal; replacement cleanup; no storage secrets in frontend; production adapter configuration from environment variables; container smoke test without persistent local uploads.

### T022 — ✅ Complete: Add rate limits, audit coverage, security headers, and observability

**Depends on:** T004, T011, T014, T019  
**Outcome:** Security and operational protections are present before public exposure.

- Rate-limit login, registration, claim, UTR, approval, and check-in endpoints.
- Add security headers, explicit CORS, request IDs, structured logs, and health/readiness endpoints.
- Verify logs exclude credentials, tokens, UTR, and full participant records.
- Complete cross-organizer and unauthorized negative-path coverage.

**Tests:** rate-limit behavior; header/CORS assertions; log redaction; health/readiness; authorization matrix.

### T023 — ✅ Complete: Add PostgreSQL integration and concurrency test suite

**Depends on:** T003, T011, T014, T019  
**Outcome:** Critical transactional behavior is tested against the production database engine.

- Run migrations against disposable PostgreSQL.
- Test concurrent registration/reservation and approval/check-in.
- Test unique constraints and rollback behavior.
- Keep SQLite tests limited to local convenience, not concurrency claims.

**Tests:** all required negative tests from requirements; concurrent capacity never oversells.

### T024 — ✅ Complete: Create deployment configuration and production runbook

**Depends on:** T004, T005, T021, T022, T023  
**Outcome:** A beginner can deploy and operate the app using GitHub-connected services.

- Add a Dockerfile and production-safe backend start command using the configured port (including platform `$PORT` compatibility) without requiring a specific hosting provider.
- Ensure the backend image is stateless, writes no required persistent application data to the container filesystem, and receives secrets/endpoints only through environment variables.
- Add frontend build configuration and environment examples with placeholders only.
- Add explicit migration/release command; disable automatic production migration.
- Document the required contracts for static frontend hosting, Docker-compatible backend hosting, standard PostgreSQL, S3-compatible object storage, Google OAuth, CORS, secrets, backups, rollback, and logs.
- If Vercel, Render, Supabase, Railway, Neon, Cloudflare, or another provider is mentioned, label it as a replaceable operational example and document the inputs needed to replace it.
- Add no-domain preview/public deployment instructions.

**Tests:** clean deployment from a fresh checkout; Docker image build and container smoke test; backend health endpoint; migration status against standard PostgreSQL; storage adapter configuration from environment variables; provider replacement checklist; no demo credentials, secrets, or provider-specific business logic in artifacts.

### T025 — Run deployed end-to-end smoke test and launch gate

**Depends on:** T008 through T024 as applicable  
**Outcome:** The public POC passes the complete product journey.

Run this flow with non-sensitive test data:

1. Admin creates/activates Organizer A.
2. Organizer A creates and publishes a running/cycling event.
3. Organizer configures UPI and ticket tiers.
4. Guest runner registers with email or phone.
5. Runner sees UPI QR and optional UTR field.
6. Organizer approves/rejects from the scoped registration list.
7. Runner sees durable status and confirmed QR ticket.
8. Participant signs in with email/password or Google and sees eligible registration.
9. Organizer exports the event and checks the participant in once.
10. Organizer B and Participant B cannot access Organizer A/Participant A data.

Do not call the POC launch-ready if any security, privacy, authorization, migration, backup, or concurrency gate fails.

## Launch gate checklist

- [ ] No hard-coded credentials remain.
- [ ] No card fields or merchant payment code remain in the POC flow.
- [ ] All protected endpoints enforce backend authorization.
- [ ] Cross-organizer and cross-participant negative tests pass.
- [ ] PostgreSQL migrations are reviewed and reproducible.
- [ ] Registration capacity cannot oversell under concurrency.
- [ ] Approval/rejection/check-in are idempotent and audited.
- [ ] Secrets are configured outside source control.
- [ ] HTTPS, CORS, CSRF, secure cookies, and rate limits are verified.
- [ ] Backups and rollback steps are documented.
- [ ] Deployed end-to-end smoke test passes.
