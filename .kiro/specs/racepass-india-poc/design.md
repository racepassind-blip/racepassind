# RacePass India POC — Technical Design

**Status:** Proposed  
**Requirements:** `requirements.md`  
**Version:** 0.1

## 1. Design goals

This design keeps RacePass simple enough to build in days while avoiding the shortcuts that would create security or scaling problems later.

The central decision is:

> Build a secure modular monolith now, with clear domain modules and a PostgreSQL data model that can support multiple organizers and concurrent registrations. Do not introduce microservices until real traffic proves they are needed.

The first production flow is manual UPI. RacePass records the registration and verification decision; money moves directly from the runner to the organizer and is never held by RacePass.

## 2. Architecture decision summary

| Area | Decision | Reason |
|---|---|---|
| Frontend | Existing React + Vite + TypeScript | Reuse the working public event UI and avoid a rewrite |
| Backend | FastAPI modular monolith | Fast to develop, typed request validation, clear module boundaries |
| ORM/migrations | SQLAlchemy 2 + Alembic | Already present and suitable for PostgreSQL |
| Production database | Standard PostgreSQL | Transactions, row locking, indexes, backups, and multi-instance support without provider-specific application dependencies |
| Local database | SQLite only for local development | Easy setup; not safe as the production checkout database |
| Authentication | Backend-owned session flow with email/password and Google OAuth | Authorization remains server-side and works for participant, organizer, and admin roles |
| Payment | Manual UPI only | Organizer receives money directly; RacePass verifies using optional UTR/reference |
| QR ticket | Random server-side ticket token encoded as QR | QR contains no personal or payment data |
| Event assets | `StorageService` backed by an S3-compatible adapter in production | Application instances must not depend on local disk or a provider SDK |
| Backend deployment | Docker-compatible stateless container | The same image/process contract can run on any compatible container platform or host |
| Configuration | Typed settings loaded from environment variables | Credentials, endpoints, origins, and migration behavior remain outside source code |
| Deployment examples | Replaceable hosting/database/object-storage providers | Operational examples must not become domain or service dependencies |
| API shape | Versioned JSON API under `/api/v1` | Stable contracts for future mobile apps and integrations |

## 3. System context and trust boundaries

```text
Runner browser / Organizer browser / Admin browser
                         |
                         | HTTPS, explicit CORS, secure session + CSRF
                         v
              React/Vite frontend (public UI)
                         |
                         | JSON API; browser never trusted for prices or roles
                         v
              FastAPI modular monolith
       Auth | Events | Registration | Payment | Check-in | Admin
             |             |              |
             v             v              v
       PostgreSQL     Object storage    Structured logs/metrics
```

Trust boundaries:

1. The browser is untrusted. It may display forms, but it cannot decide role, price, inventory, organizer ownership, payment state, or confirmation state.
2. The API is the only component allowed to change business state.
3. The database is the source of truth for users, organizations, events, tickets, registrations, payments, and check-ins.
4. Object storage holds QR images and future event assets; its credentials are server-only.
5. Google is an identity provider. Google identity claims are validated by the backend before an account is created or linked.

## 4. Backend code structure

Refactor the current flat backend into a modular package without changing the public behavior all at once:

```text
backend/
  app/
    main.py
    config.py                 # environment settings and validation
    db.py                     # engine, sessions, transaction helpers
    models/
      user.py
      organization.py
      event.py
      registration.py
      payment.py
      audit.py
    api/
      deps.py                 # current user, role, organization dependencies
      v1/
        auth.py
        public_events.py
        organizer_events.py
        registrations.py
        participant.py
        checkins.py
        admin.py
    services/
      auth_service.py
      event_service.py
      registration_service.py
      payment_service.py
      qr_service.py
      storage_service.py        # provider-neutral interface/use cases
      audit_service.py
    infrastructure/
      storage/
        local_adapter.py
        s3_compatible_adapter.py
      oauth/
        google_adapter.py       # identity-provider boundary only
    repositories/              # database access where queries are non-trivial
    schemas/                   # Pydantic request/response models
    tests/
  migrations/
  alembic.ini
  requirements.txt
```

`services/` and domain modules must depend on interfaces, not on Google, storage-provider, hosting-provider, or database-provider SDKs. Provider-specific implementations belong under `infrastructure/` and are selected by typed environment configuration.

## 5. Authentication and authorization design

### 5.1 Session model

Use an opaque session token in a secure HTTP-only cookie rather than storing authentication tokens in `localStorage`.

Add an `auth_sessions` table containing:

- `id`
- `user_id`
- `token_hash`
- `created_at`
- `expires_at`
- `last_seen_at`
- `revoked_at`
- optional user-agent/IP metadata with privacy limits

The raw token is sent only in the cookie. Only its hash is stored in PostgreSQL. This allows logout/revocation and supports multiple backend instances.

Cookie rules in production:

- `HttpOnly: true`
- `Secure: true`
- explicit expiration
- `SameSite=None` when frontend and API are on different sites; use `Lax` when deployed under the same site
- never log cookie values

Because cross-origin cookies can be used for state-changing requests, add a CSRF token mechanism: the API issues a non-secret CSRF cookie and mutating frontend requests send the same value in an `X-CSRF-Token` header. CORS allows only configured frontend origins and credentials.

### 5.2 Email/password

- Normalize email to lowercase and trim whitespace before lookup.
- Hash passwords with Argon2id or another modern adaptive password hash.
- Never return password hashes.
- Rate-limit login and account creation.
- Return generic login errors so an attacker cannot enumerate accounts.
- Store `email_verified_at`. A production account-linking flow must not treat an unverified email as sufficient proof of ownership.
- Password reset and email verification are security workflows, not a reason to store raw tokens; store hashed, expiring tokens.

### 5.3 Google OAuth

Use a backend-controlled authorization-code flow with state and PKCE:

1. Frontend starts `/api/v1/auth/google/start`.
2. Backend creates a short-lived state/PKCE record and redirects to Google.
3. Google redirects to the backend callback.
4. Backend validates state, exchanges the code, validates issuer/audience/expiry/email claims, and finds or creates the user.
5. Backend assigns only explicitly approved roles; Google sign-in never grants organizer/admin privileges by itself.
6. Backend creates a RacePass session and redirects to the frontend.

The Google client secret exists only in backend deployment secrets. Redirect URIs are configured separately for local, preview, and production environments.

### 5.4 Registration linking

Guest registrations contain the submitted contact data, normalized for matching. After a participant is authenticated:

- A verified Google email can be used for exact email matching.
- A verified email/password account can be used for exact email matching.
- Phone matching is only a candidate until the phone is verified or the participant supplies the registration reference plus private claim code.
- A matched registration is linked in a transaction and cannot be claimed by a second account.
- No endpoint accepts only an arbitrary email or phone and returns registrations.

This preserves the requested matching behavior without making contact information a password.

### 5.5 Backend authorization

Every protected endpoint resolves:

```text
current_user -> role -> organization membership -> resource ownership
```

Use dependencies such as `require_user`, `require_role`, and `require_event_access`. Never rely on a frontend `ProtectedRoute` for security. Organizer A must receive the same not-found/forbidden-safe response when attempting to access Organizer B's resource.

## 6. Data model and migration strategy

The existing `models.py` and `0002_ticketing_schema.py` already contain useful foundations. Extend them with additive migrations where possible. Do not silently drop production tables or use `create_all` as a production migration mechanism.

### 6.1 Core entities

```text
users
  id, name, email, normalized_email, phone, normalized_phone,
  password_hash, role, email_verified_at, phone_verified_at, is_active

organizations
  id, name, created_by, status, fee_type, fee_value_paise,
  fee_percentage_basis_points

organization_members
  organization_id, user_id, member_role, created_at

events
  id, organization_id, name, description, sport, status,
  location/city/state/country, dates, capacity, banner_url, rules

event_categories
  id, event_id, name, distance, age/gender constraints, capacity

tickets
  id, event_id, category_id, name, description, price_paise,
  currency, quantity_total, quantity_reserved, quantity_sold,
  sale_start, sale_end, max_per_user, is_active

event_payment_settings
  id, event_id, method, upi_id, payee_name, instructions,
  qr_image_url, is_active

participants
  id, name, email, normalized_email, phone, normalized_phone,
  age/date_of_birth, gender, jersey_size, emergency_contact, team_name

registrations
  id, event_id, participant_id, user_id_nullable, ticket_id,
  category_id, quantity, unit_price_paise, total_amount_paise,
  registration_reference, confirmation_token_hash, claim_code_hash,
  reserved_until, payment_status, registration_status,
  ticket_token_hash, created_at, updated_at

payments
  id, registration_id/order_id, method, expected_amount_paise,
  currency, utr_reference, status, decision_reason,
  submitted_at, reviewed_by, reviewed_at

checkins
  id, registration_id, checked_in_by, checked_in_at, device_info

auth_sessions
  id, user_id, token_hash, expires_at, revoked_at

audit_logs
  id, actor_user_id, action, resource_type, resource_id,
  metadata_json, created_at
```

Existing `orders` and `order_items` can be retained as the accounting boundary even though the POC has no gateway. A manual-UPI registration may have one order and one payment record with `method = manual_upi`. This avoids a redesign when Razorpay is introduced later.

Existing `EventCategory` maps to `event_categories`. Existing `Ticket` maps to ticket tiers; add `category_id` and explicit integer paise semantics. Existing `Registration`, `Participant`, `Payment`, and `Checkin` are extended rather than replaced where practical.

### 6.2 Money and identifiers

- Store all money as integer paise (`₹799` becomes `79900`) and currency `INR`.
- Never calculate final totals from browser-supplied prices.
- Use UUIDs for internal identifiers.
- Use a separate human-readable registration reference for support and communication.
- Store only hashes of confirmation tokens, claim codes, and QR ticket tokens when the server needs to validate them.
- Never put participant data, UTR values, or secrets inside QR payloads.

### 6.3 Constraints and indexes

Add database constraints/indexes for:

- unique normalized user email
- unique organization membership
- unique registration reference
- unique registration claim ownership where applicable
- indexed event status/date/city/sport
- indexed event organization
- indexed ticket event/category and active sale window
- indexed registration event/status/reference
- indexed normalized participant email/phone
- indexed payment status/UTR
- indexed token hashes

Use PostgreSQL row locks when reserving or approving ticket inventory. A database constraint and transaction are the final protection against overselling.

## 7. Registration and manual UPI state machine

### 7.1 Registration states

```text
created
  ↓
awaiting_payment
  ↓
pending_verification
  ├── confirmed
  │     └── checked_in
  ├── rejected
  └── expired
```

Payment status is kept separate:

```text
pending -> reference_submitted -> approved
                         \-> rejected
```

Because the UTR is optional, an organizer may approve a payment without a reference if they independently verified the transfer. The UI should explain that a UTR helps the organizer but is not proof of payment.

### 7.2 Registration creation transaction

`POST /registrations` performs the following in one short transaction:

1. Validate event status and registration window.
2. Load the selected ticket row with a PostgreSQL `FOR UPDATE` lock.
3. Validate category/ticket ownership, price, quantity (`1` in the POC), and available capacity.
4. Increment a reservation counter or create a reservation with `reserved_until = now + 30 minutes`.
5. Create participant snapshot, registration, order, and pending manual-UPI payment.
6. Generate a random confirmation token and claim code; store only hashes.
7. Write `registration_created` audit record.
8. Commit and return safe registration details plus a one-time confirmation credential to the browser.

The endpoint accepts an idempotency key. A retry with the same key returns the original registration rather than creating a duplicate.

### 7.3 UPI display

The event payment settings provide:

- UPI ID
- payee name
- payment instructions
- optional uploaded QR image

RacePass can generate a payment URI:

```text
upi://pay?pa=<upi_id>&pn=<payee_name>&am=<amount_rupees>&cu=INR&tn=<registration_reference>
```

The QR encodes only payment-initiation data. It does not prove that a payment occurred. The amount shown by the API is the authoritative amount.

### 7.4 Approval/rejection transaction

For approval:

1. Authenticate organizer/admin.
2. Lock the registration, payment, and ticket rows.
3. Verify the actor owns the event or is an admin.
4. Verify current state is reviewable.
5. Change payment to `approved`, registration to `confirmed`.
6. Convert the reservation to sold inventory exactly once.
7. Generate/store a hash of the final ticket token.
8. Audit the decision.
9. Commit.

For rejection, record the reason, change the registration to `rejected`, and release the reservation. Repeating an approval or rejection returns the current state without changing inventory a second time.

A scheduled cleanup job or a protected maintenance endpoint expires reservations after 30 minutes. The design must make this a safe, repeatable operation.

## 8. API design

All new endpoints live under `/api/v1`. Public responses contain only public event data; participant and payment data are never serialized into public event responses.

### Authentication

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
GET  /api/v1/auth/google/start
GET  /api/v1/auth/google/callback
POST /api/v1/auth/verify-email
```

### Public events

```text
GET /api/v1/events?cursor=&sport=&city=&from=&to=&q=
GET /api/v1/events/{event_id}
```

List responses are paginated. Event detail includes categories, ticket tiers, availability, and safe manual-UPI display configuration where the event is published.

### Organizer events and settings

```text
GET  /api/v1/organizer/events
POST /api/v1/organizer/events
GET  /api/v1/organizer/events/{event_id}
PATCH /api/v1/organizer/events/{event_id}
POST /api/v1/organizer/events/{event_id}/publish
POST /api/v1/organizer/events/{event_id}/unpublish
POST /api/v1/organizer/events/{event_id}/categories
POST /api/v1/organizer/events/{event_id}/tickets
PUT  /api/v1/organizer/events/{event_id}/payment-settings
```

Every organizer endpoint checks organization membership and event ownership.

### Registration and participant

```text
POST  /api/v1/registrations
POST  /api/v1/registrations/payment-reference
GET   /api/v1/registrations/confirmation
POST  /api/v1/participants/registrations/claim
GET   /api/v1/participants/registrations
GET   /api/v1/participants/registrations/{registration_id}
```

Guest confirmation/payment-reference requests require the opaque confirmation credential in the request body/header. They never support contact-only lookup.

### Organizer operations

```text
GET  /api/v1/organizer/registrations?event_id=&status=&q=&cursor=
POST /api/v1/organizer/registrations/{registration_id}/approve
POST /api/v1/organizer/registrations/{registration_id}/reject
GET  /api/v1/organizer/events/{event_id}/registrations.csv
POST /api/v1/organizer/checkins/scan
```

CSV generation is bounded and authorization-scoped. If exports become large, move generation to a background job without changing the endpoint contract.

### Admin operations

```text
GET   /api/v1/admin/organizers
POST  /api/v1/admin/organizers
PATCH /api/v1/admin/organizers/{organization_id}
PUT   /api/v1/admin/organizers/{organization_id}/fee-settings
GET   /api/v1/admin/events
GET   /api/v1/admin/registrations
```

Admin fee settings are stored as `none`, `fixed_per_registration`, or `percentage`, with value zero by default. They are visible to admins but do not deduct or collect money in this POC.

## 9. Frontend design

### 9.1 API client

Create one typed API client that:

- uses `credentials: "include"` for session cookies
- sends the CSRF header for mutations
- converts API errors into safe user messages
- never stores passwords, session tokens, claim codes, or UPI secrets in localStorage
- supports the `/api/v1` base URL from `VITE_API_URL`

Replace the current dummy `AuthContext` with a server-backed auth provider that calls `/auth/me` on startup and invalidates React Query data on logout.

### 9.2 Existing UI reuse

Keep the current public visual language and reuse:

- `Layout`, `Navbar`, `Footer`
- event cards and event detail visual structure
- React Query for server state
- `ProtectedRoute` as a navigation convenience only

Replace:

- hard-coded credentials in `AuthContext`
- fake participant dashboard data
- simulated checkout timeout
- card-number/expiry/CVC fields
- fabricated organizer registrations
- toast-only confirmation/download behavior

### 9.3 New/changed screens

- Login/register: email/password and Google sign-in.
- Public Explore: Indian events with filters and pagination.
- Event setup: event, categories, ticket tiers, UPI settings, draft/publish.
- Guest registration: one participant per registration, at least email or phone, no card fields.
- Payment instructions: UPI ID, QR, amount, optional UTR.
- Confirmation: pending/confirmed/rejected status, reference, claim guidance, QR ticket when confirmed.
- My Registrations: backend records with matching/claim flow.
- Organizer registrations: filters, approval/rejection reason, export, check-in.
- Admin: organizer onboarding and zero-by-default fee settings.

## 10. Storage and QR image handling

Use a provider-neutral `StorageService` interface with:

```text
put_private(file, metadata) -> object_key
get_read_url(object_key, expires_in) -> short_lived_url
remove(object_key) -> idempotent result
```

The service is the only dependency used by domain and application services. Its production implementation shall use an S3-compatible API; a local filesystem implementation may be used only for development. Provider SDKs, endpoint quirks, bucket naming, public URL construction, and credentials remain inside the infrastructure adapter.

The backend validates image MIME type, extension, size, and dimensions before upload. Responses use short-lived signed URLs rather than exposing storage credentials. Object keys are opaque and must not contain participant data.

Generated UPI QR images do not need permanent storage: regenerate them from validated payment settings and the registration amount. Organizer-uploaded QR images use the storage service.

The storage contract must be testable with a protocol-compatible fake or local adapter, including private writes, authorized short-lived reads, missing objects, replacement cleanup, and idempotent removal.

## 11. Deployment plan

### 11.1 Provider-neutral deployment contract

The backend shall be packaged as a Docker-compatible stateless container. The image must accept configuration through environment variables, expose the configured HTTP port, write no required persistent state to the container filesystem, and run an explicit non-development process command such as:

```text
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

The frontend shall be buildable as static assets with a public `VITE_API_URL`. Database migrations shall run as an explicit release/deployment command rather than as an implicit application-startup side effect.

The first deployment may use any Git-connected frontend host, Docker-compatible backend host, standard PostgreSQL provider, and S3-compatible object-storage provider that meet these contracts. Vercel, Render, Supabase, Railway, Neon, Cloudflare, or other named services are replaceable operational examples only; none is an architecture decision and none may be required by domain or service code.

For the beginner-friendly launch path, document one concrete provider combination as an example, but also document the equivalent inputs needed to replace each provider:

1. Frontend static hosting for the built React/Vite assets.
2. A Docker-compatible backend runtime.
3. Standard PostgreSQL reachable through `DATABASE_URL`.
4. Private S3-compatible object storage reachable through the storage adapter settings.
5. Google OAuth redirect URLs configured through environment variables.

No production domain is required to begin, but a custom domain should be added before serious public usage so frontend/API cookies, OAuth redirects, and branding are stable.

### 11.2 Required environment variables

Backend:

```text
DATABASE_URL
SESSION_SECRET
CSRF_SECRET
FRONTEND_ORIGINS
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
TICKET_SIGNING_SECRET
STORAGE_ENDPOINT
STORAGE_BUCKET
STORAGE_ACCESS_KEY
STORAGE_SECRET_KEY
ENVIRONMENT=production
AUTO_MIGRATE=false
```

Frontend:

```text
VITE_API_URL
```

No secrets belong in the frontend environment. `VITE_*` values are public in a Vite build.

### 11.3 Deployment sequence

1. Provision a standard PostgreSQL database and store its private connection string.
2. Run reviewed Alembic migrations as a deployment/release command.
3. Seed only demo/public-safe data explicitly; never seed default passwords in production.
4. Deploy backend with health and readiness endpoints.
5. Configure frontend origin in backend CORS.
6. Configure Google OAuth redirect URLs.
7. Deploy frontend with the backend API URL.
8. Run smoke tests: health, public events, guest registration, UPI display, organizer login, approval, confirmation, and check-in.
9. Confirm logs do not contain secrets or participant payloads.

Application startup must not silently run migrations or create demo admin credentials in production.

## 12. Security implementation checklist

Every implementation task must address the relevant items below before completion:

- Backend authentication and resource authorization.
- Organization ownership checks.
- Request/schema validation and safe error responses.
- Secure password hashing and OAuth state/PKCE.
- HTTP-only secure sessions and CSRF protection.
- Explicit CORS origins and HTTPS.
- Rate limits for login, registration, claiming, payment-reference updates, approval, and check-in.
- Idempotency for registration creation, payment decisions, and check-in.
- PostgreSQL transactions and row locks for inventory.
- Non-guessable hashed tokens for confirmation, claims, and tickets.
- Data minimization and actor-specific response schemas.
- Audit records for state-changing actions.
- No sensitive data in logs, URLs where avoidable, QR payloads, or frontend local storage.
- Dependency and migration review as part of the normal implementation workflow.
- Negative tests for every protected endpoint and cross-organizer boundary.

## 13. Scalability plan

The initial deployment can run one backend instance because PostgreSQL is the source of truth. It can scale without changing the API as follows:

### Initial capacity assumption

Design and test for approximately:

- 10 organizers
- 100 published events
- 10,000 registrations per month
- bursts of concurrent registrations for a popular event

These are planning targets, not a promise of capacity.

### First scaling steps

1. Add indexes and cursor pagination before data grows.
2. Monitor slow queries and registration transaction duration.
3. Move CSV exports and email/verification work to background jobs.
4. Put the stateless backend behind a load balancer and run multiple instances.
5. Add a managed Redis/cache only when measurement shows database/session/rate-limit pressure.
6. Add read replicas only when read traffic justifies them; registration writes always use the primary.
7. Keep storage and future payment adapters behind interfaces so provider changes do not affect the registration API.

Do not split modules into services during the POC. The module boundaries are the future extraction boundaries if scale later requires it.

## 14. Testing strategy

### Backend

- Unit tests for price calculation, state transitions, normalization, token verification, and fee configuration.
- API tests for authentication, role/resource authorization, validation, and safe response fields.
- Transaction tests for concurrent registration, reservation expiry, approval idempotency, and check-in idempotency.
- Integration tests against PostgreSQL for locking and constraints; SQLite tests are not sufficient for concurrency behavior.

### Frontend

- Component tests for guest registration validation, UPI instructions, status rendering, and account claim states.
- API-mocked tests for auth bootstrap, errors, organizer approval, and participant dashboard.
- Playwright smoke flow for Explore -> registration -> payment reference -> organizer approval -> participant ticket -> check-in.

### Deployment smoke test

Run the same core flow against the deployed frontend/backend using a test event and non-sensitive data. Verify HTTPS, CORS, Google callback, migrations, health endpoint, and that a second organizer cannot access the first organizer's data.

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Manual UPI payment cannot be automatically proven | Keep status pending until organizer decision; show UTR as supporting evidence only |
| Guest registration data is claimed by another user | Use authenticated matching, verified contact where possible, and reference + claim code |
| Overselling during a popular registration window | PostgreSQL row locks, reservations, idempotency keys, and concurrency tests |
| Cross-site session misconfiguration | Explicit CORS, secure cookie settings, CSRF checks, and deployed smoke tests |
| Google OAuth setup delays the POC | Implement email/password first behind the same auth interface; keep Google as a required configured adapter before public launch |
| QR upload storage complicates deployment | Use generated QR immediately and a storage adapter/private bucket for uploaded organizer QR images |
| Scope expands beyond a few days | Do not add merchant payments, refunds, coupons, results, or mobile apps until the core loop passes the deployed smoke test |

## 16. Implementation order

Implementation follows the requirements document's vertical order:

1. Backend configuration, package structure, migration baseline, and test harness.
2. Users, sessions, roles, organization membership, and authorization dependencies.
3. Organizer onboarding and secure event/category/ticket creation.
4. Public Explore and event detail API/UI with INR/Indian seed data.
5. Registration transaction, one-ticket rule, reservation expiry, and idempotency.
6. Manual UPI settings, generated QR, optional uploaded QR, and UTR update.
7. Organizer registration list, payment approval/rejection, audit records, and CSV.
8. Durable confirmation, QR ticket, secure guest confirmation access, and status UI.
9. Participant account linking by verified match and claim code fallback.
10. Organizer QR/reference check-in with idempotency.
11. Google OAuth, email verification, rate limits, observability, and production hardening.
12. Deployment, PostgreSQL integration tests, Playwright smoke test, backup/rollback runbook.

Each task must include its security, authorization, concurrency, failure, audit, and test behavior before it is considered complete.
