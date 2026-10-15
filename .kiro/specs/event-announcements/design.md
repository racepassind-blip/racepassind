# Design: Public Event Announcements

## 1. Architecture

Announcements extend the existing event communications domain:

```text
Organizer event communications
        ↓ authorized mutation
EventAnnouncement service
        ↓
event_announcements table
        ├─ public event announcement API
        ├─ organizer announcement API
        ├─ event-detail latest updates
        ├─ audit records
        ├─ optional email/WhatsApp distribution
        └─ optional VAPID web push delivery
```

The public page is the canonical content. Email and WhatsApp contain a short summary and link back to the public announcement.

Participant dashboard reads use a dedicated authenticated query joining confirmed registrations to published event announcements. This keeps the dashboard scoped to the participant's own events without exposing updates from the public event catalogue.

## 2. Database design

### 2.1 `event_announcements`

Implemented migrations: `0078_event_announcements.py` and `0079_push_subscriptions.py`, following `0077_registration_attribution`.

```sql
CREATE TABLE event_announcements (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id),
    title VARCHAR(160) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    scheduled_for TIMESTAMPTZ NULL,
    published_at TIMESTAMPTZ NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_event_announcement_status
      CHECK (status IN ('DRAFT','SCHEDULED','PUBLISHED','ARCHIVED')),
    CONSTRAINT ck_event_announcement_schedule
      CHECK (
        (status = 'SCHEDULED' AND scheduled_for IS NOT NULL) OR
        (status <> 'SCHEDULED')
      )
);

CREATE INDEX ix_event_announcements_public
  ON event_announcements(event_id, status, published_at DESC);

CREATE INDEX ix_event_announcements_schedule
  ON event_announcements(status, scheduled_for)
  WHERE status = 'SCHEDULED';

CREATE UNIQUE INDEX uq_event_announcements_one_pinned_public
  ON event_announcements(event_id)
  WHERE is_pinned = TRUE AND status = 'PUBLISHED';
```

Foreign-key deletion behavior must follow the repository's event archival/deletion policy. Prefer preserving announcements while an event exists; use the existing administrative event-deletion cleanup service for explicit permanent deletion.

### 2.2 Model

Add `EventAnnouncement` to `backend/models.py` with typed timestamps and relationships to Event and User. Keep state values centralized as constants or a string enum compatible with PostgreSQL and SQLite test execution.

### 2.3 `push_subscriptions`

Store one browser endpoint per authenticated user and event, including the Web Push key pair, user agent, and enabled state. `EventAnnouncement.push_sent_at` bounds repeated delivery attempts.

## 3. Service design

Add `backend/app/services/announcement_service.py`.

Core operations:

```text
list_public(event_id, cursor/page)
get_public(event_id, announcement_id)
list_for_organizer(event_id, status, page)
create_draft(event, actor, payload)
update(event, announcement_id, actor, payload)
publish(event, announcement_id, actor, publish_at=None)
schedule(event, announcement_id, actor, scheduled_for)
archive(event, announcement_id, actor)
restore(event, announcement_id, actor)
pin(event, announcement_id, actor)
delete_draft(event, announcement_id, actor)
publish_due(now, limit)
```

The service owns state-transition validation. API routers must not duplicate lifecycle rules.

### 3.1 Concurrency

- Lock the target announcement for transitions.
- Pinning locks the event or all pinned rows before unpinning/pinning.
- Scheduled publication selects due rows with a safe worker strategy and rechecks status under lock.
- Repeated publish/schedule worker operations are idempotent.

### 3.2 Audit actions

Use existing `record_audit` with actions:

```text
event_announcement_created
event_announcement_updated
event_announcement_published
event_announcement_scheduled
event_announcement_archived
event_announcement_restored
event_announcement_pinned
event_announcement_unpinned
event_announcement_draft_deleted
event_announcement_distributed
```

## 4. API design

### 4.1 Public

```http
GET /api/v1/events/{event_id}/announcements?page=1&page_size=20
GET /api/v1/events/{event_id}/announcements/{announcement_id}
```

List response:

```json
{
  "event": {
    "id": "uuid",
    "name": "Hyderabad Night Run",
    "eventDate": "2026-11-15",
    "location": "Hyderabad"
  },
  "items": [
    {
      "id": "uuid",
      "title": "Start time updated",
      "body": "The 10K now starts at 6:15 PM.",
      "isPinned": true,
      "publishedAt": "2026-10-14T12:00:00Z",
      "updatedAt": "2026-10-14T12:15:00Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

No creator IDs, internal status history, schedule metadata, or distribution logs appear publicly.

### 4.2 Organizer/admin

```http
GET    /api/v1/organizer/events/{event_id}/announcements
POST   /api/v1/organizer/events/{event_id}/announcements
GET    /api/v1/organizer/events/{event_id}/announcements/{announcement_id}
PUT    /api/v1/organizer/events/{event_id}/announcements/{announcement_id}
POST   /api/v1/organizer/events/{event_id}/announcements/{announcement_id}/publish
POST   /api/v1/organizer/events/{event_id}/announcements/{announcement_id}/schedule
POST   /api/v1/organizer/events/{event_id}/announcements/{announcement_id}/archive
POST   /api/v1/organizer/events/{event_id}/announcements/{announcement_id}/restore
POST   /api/v1/organizer/events/{event_id}/announcements/{announcement_id}/pin
DELETE /api/v1/organizer/events/{event_id}/announcements/{announcement_id}
POST   /api/v1/organizer/events/{event_id}/announcements/{announcement_id}/broadcast-email
```

All mutations require organizer/admin role, event ownership, CSRF protection, input validation, and rate limiting where available.

## 5. Frontend design

### 5.1 Public page

Add `PublicEventAnnouncements.tsx` and route:

```tsx
<Route path="/event/:eventId/announcements" element={<PublicEventAnnouncements />} />
```

Layout:

```text
Back to event
Event title · date · location
Announcements

[Pinned update]
[Newest update]
[Older update]

Pagination / load more
```

Use semantic article/time elements, preserved line breaks, share/copy controls, loading skeleton, fetch-error retry, and quiet empty state.

### 5.2 Event detail

Add a latest-announcements query limited to two or three items. Render after key event logistics and before registration/organizer information. Avoid blocking event detail if the announcement request fails.

### 5.3 Organizer communications

Replace the current “Coming soon” communication placeholder with an announcements workspace while retaining registration-link and WhatsApp-template tools. Add:

- Status filters.
- Compact announcement list/cards.
- Editor dialog or dedicated nested route.
- Preview mode matching the public page.
- Publish/schedule/archive confirmations.
- Open/copy public page actions.
- Optional email distribution after publication.

Announcement creation must remain accessible for free events even if bulk email is locked. The organizer navigation continues to use the existing Communications capability; no new sidebar entry is required for MVP.

## 6. Email integration

Reuse `broadcast_event_update` and `EmailLog`. Add announcement-specific reference types such as:

```text
EVENT_ANNOUNCEMENT_BROADCAST
```

The email body contains escaped announcement text, event name, and canonical public URL. Distribution returns attempted/sent/delayed/failed counts. Publishing and broadcasting are separate transactions so email failure never rolls back a published public announcement.

## 7. Scheduling integration

Extend the existing recovery/background-worker approach with a bounded `publish_due_announcements` sweep. It should:

1. Select due `SCHEDULED` announcements.
2. Lock/recheck each row.
3. Transition to `PUBLISHED` and set `published_at`.
4. Record audit.
5. Commit each bounded batch safely.

Scheduled publication does not automatically send email in MVP. Push delivery is automatic for active event subscriptions when VAPID is configured.

## 8. Caching and performance

- Public list queries use the composite event/status/publication index.
- Event detail requests only the latest two or three rows.
- Organizer list is paginated.
- Public responses may use short cache headers/ETags if the current API supports them; publication/edit/archive must invalidate or naturally expire the cache.
- Do not denormalize announcement bodies into Event.

## 9. Failure behavior

- Public announcement failure does not break event detail.
- Mutation errors preserve editor content.
- Publish conflict returns a clear 409/422 response.
- Scheduling worker retries safely.
- Email failure is reported separately from publish success.
- Archived/unpublished event attempts return a clear validation error without changing announcement state.

## 10. Testing strategy

Backend:

- Model/migration constraints.
- Event ownership/admin override.
- Public visibility isolation.
- State-transition matrix.
- Pin concurrency and uniqueness.
- Schedule worker idempotency.
- Archived/draft event behavior.
- Input escaping and size validation.
- Email distribution separation/idempotency.

Frontend:

- Public loading/error/empty/list/pinned states.
- Organizer draft/edit/publish/schedule/archive flow.
- Free-event announcement availability and paid-email lock.
- Share URL generation.
- Mobile overflow at 320/393/430px and landscape.
- Keyboard access and status labels.

## 11. Rollout

1. Apply migration and deploy read/write APIs.
2. Deploy organizer editor behind a feature flag if desired.
3. Deploy public route and event-detail preview.
4. Enable scheduling worker.
5. Enable optional email distribution after delivery/audit tests pass.

Rollback disables new routes/UI and worker first. Preserve the table and published content during rollback; do not drop announcement data as part of an application rollback.
