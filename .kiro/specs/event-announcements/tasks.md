# Tasks: Public Event Announcements

**Requirements:** `requirements.md`  
**Design:** `design.md`  
**Status:** In progress — persistence, APIs, scheduling worker, public page, organizer workspace, event-detail preview, email distribution, and share actions are implemented locally. Broader E2E coverage and production smoke verification remain.

## Working rules

- Keep the public announcement page available for free and paid published events.
- Keep email distribution separate and subject to existing communications entitlement and limits.
- Reuse backend event ownership; never rely on frontend route guards.
- Store/render plain text only for MVP.
- Use integer IDs/timestamps and existing audit patterns; do not introduce provider coupling.
- Keep each phase deployable and backward compatible.

## Phase 1 — Persistence and domain lifecycle

### T001 — Add announcement migration and model

**Files:** `backend/migrations/versions/0078_event_announcements.py`, `backend/models.py`

- Confirm current Alembic head before assigning the revision.
- Create `event_announcements` with lifecycle, actor, pin, schedule, and timestamp fields.
- Add public-list, schedule-worker, and single-pinned-announcement indexes/constraints.
- Add SQLAlchemy relationships without changing existing Event serialization.

**Tests:** PostgreSQL migration; SQLite-compatible model tests; invalid status/schedule constraints; unique pinned row.

### T002 — Implement announcement service

**Depends on:** T001

- Add lifecycle operations and transition validation.
- Enforce event status rules.
- Implement atomic pin/unpin.
- Add organizer/admin serializers and privacy-safe public serializers.
- Add audit records for every material operation.

**Tests:** transition matrix; ownership; public isolation; archived-event behavior; idempotent publish; pin concurrency.

## Phase 2 — APIs

### T003 — Add public announcement endpoints

**Depends on:** T002

- Add paginated public list and single-announcement endpoints under public events.
- Return event summary plus published announcement data only.
- Add bounded page size and stable ordering: pinned first, then `published_at DESC`, then ID.

**Tests:** unpublished event; draft/scheduled/archived leakage; empty/list/detail; pagination; response field allow-list.

### T004 — Add organizer/admin announcement endpoints

**Depends on:** T002

- Add list/create/read/update/publish/schedule/archive/restore/pin/delete-draft endpoints.
- Apply event ownership, organizer/admin role, CSRF, and rate-limit patterns.
- Return clear transition and validation errors.

**Tests:** cross-organizer denial; inactive organizer; admin support; invalid transition; archived event; duplicate request behavior.

## Phase 3 — Public frontend

### T005 — Build public announcement page

**Depends on:** T003

- Add `/event/:eventId/announcements` route.
- Build responsive loading/error/empty/list/pinned states.
- Add copy/share controls and back-to-event navigation.
- Use semantic article/time markup and safe line-break rendering.

**Tests:** route states, public visibility, share URL, accessibility, mobile overflow.

### T006 — Add event-detail latest updates

**Depends on:** T003

- Fetch latest two or three published announcements independently from core event data.
- Render pinned/newest updates and “View all announcements”.
- Fail quietly without breaking event registration.

**Tests:** no-announcement omission; pinned ordering; API failure isolation; mobile layout.

## Phase 4 — Organizer frontend

### T007 — Add announcement list to Communications

**Depends on:** T004

- Add status counts/filters, cards/table, public-page link, pin, archive, and restore actions.
- Preserve existing share/template tools.
- Allow announcements for free events even when bulk email is locked.

**Tests:** organizer/admin access, free-event behavior, filters, empty/error states, mobile layout.

### T008 — Build editor and preview

**Depends on:** T004, T007

- Add title/body fields, live character guidance, public preview, save draft, publish now, and schedule actions.
- Preserve unsaved editor content on request failure.
- Confirm archive/delete-draft actions.

**Tests:** validation, draft vs publish distinction, schedule timezone conversion, corrected published update, keyboard flow.

## Phase 5 — Scheduling and distribution

### T009 — Publish scheduled announcements

**Depends on:** T002

- Add bounded background/recovery sweep.
- Wire it into the existing worker lifecycle.
- Record publication audit without auto-email.

**Tests:** due/not-due selection, concurrent workers, retries, idempotency, worker restart.

### T010 — Add explicit email distribution

**Depends on:** T004, existing email broadcast service

- Add recipient count and explicit “Email registrants” action for published announcements.
- Build escaped email content with canonical announcement URL.
- Reuse email logs/limits and return delivery summary.
- Keep publish success independent from email success.

**Tests:** entitlement lock, recipient deduplication, disabled email, daily limits, retry idempotency, safe HTML escaping.

### T010a — Add mobile push updates

- Store event-scoped browser subscriptions and validate confirmed registration ownership.
- Add VAPID configuration, service worker delivery, expired-endpoint cleanup, and bounded worker delivery.
- Add an explicit permission prompt with iOS Home Screen guidance and deep-link notification taps.

**Tests:** permission gesture, unsupported/denied states, subscription authorization, delivery cleanup, and notification deep links.

### T011 — Add WhatsApp/link sharing

**Depends on:** T005, T007

- Generate announcement-specific share text and link.
- Add copy link and native share fallback.
- Do not send WhatsApp messages server-side.

**Tests:** encoding, event/announcement title, canonical URL, browser fallback.

## Phase 6 — Verification and documentation

### T012 — Extend mobile and route E2E

- Add public announcement routes and organizer announcement states to the mobile audit fixtures.
- Cover create draft → publish → public read using mocked APIs.
- Assert no page overflow or clipped controls at supported widths.

### T013 — Update Kiro/current-product specs

- Add announcement route/API inventory to the main POC reconciliation.
- Record migration head after merge.
- Document scheduling worker and email reference types.

### T014 — Deployment smoke and rollback

- Verify migration in a disposable PostgreSQL environment.
- Verify public caching/visibility after publish/edit/archive.
- Verify scheduled publication worker.
- Verify email broadcast separately.
- Document rollback that preserves announcement data.
- Configure VAPID keys and run a real-device push smoke test on Android Chrome and iOS Home Screen.

## Definition of done

- All acceptance criteria in `requirements.md` pass.
- Backend authorization, transition, concurrency, privacy, and audit tests pass.
- Public and organizer frontend tests pass.
- TypeScript, production build, and changed-file lint pass.
- Mobile E2E covers public list and organizer management.
- The Kiro migration and route inventory is updated to the merged implementation.
