# Requirements: Public Event Announcements

## Background

Organizers currently use generated WhatsApp messages and event email broadcasts to communicate changes. Those channels do not provide one durable public source of truth: messages can be missed, forwarded without later corrections, or become difficult to find.

SportPass shall provide a public announcement page for each event. Organizers publish event changes once, participants read the current version from a stable link, and WhatsApp/email become optional distribution channels for that link.

## Goals

- Give every published event a stable public updates page.
- Let authorized organizers create, preview, publish, edit, pin, and archive announcements.
- Show recent announcements on the public event detail page.
- Preserve announcement history and audit important transitions.
- Keep public announcements safe to render and free of participant data.
- Reuse existing event ownership, authentication, audit, email, feature-lock, and responsive navigation patterns.

## 1. Announcement lifecycle

### REQ-1.1 Supported states

An announcement has one of four states:

- `DRAFT`: visible only to authorized organizer/admin users.
- `SCHEDULED`: visible only to authorized users until `scheduled_for` is reached.
- `PUBLISHED`: publicly visible when `published_at <= now()`.
- `ARCHIVED`: retained for organizer/admin history and removed from public responses.

The allowed transitions are:

```text
DRAFT → PUBLISHED
DRAFT → SCHEDULED
SCHEDULED → DRAFT
SCHEDULED → PUBLISHED
PUBLISHED → ARCHIVED
ARCHIVED → PUBLISHED
```

Published announcements are archived rather than deleted. Drafts may be deleted before first publication.

### REQ-1.2 Required fields

Each announcement contains:

- Event reference.
- Title: 3–160 characters.
- Body: 1–10,000 characters.
- Status.
- Optional scheduled publication time.
- Publication time.
- Pinned flag.
- Creator/updater user references.
- Created/updated timestamps.

The body uses plain text with preserved line breaks for MVP. Raw organizer HTML is never accepted or rendered.

### REQ-1.3 Pinning

At most one publicly visible announcement may be pinned per event. Pinning another announcement atomically unpins the previous one. A draft, scheduled, or archived announcement cannot be publicly pinned.

## 2. Public announcement experience

### REQ-2.1 Stable public route

Every published event has a public route:

```text
/event/:eventId/announcements
```

The page displays the event name, event date/location summary, a back-to-event link, pinned announcement first, remaining published announcements newest-first, publication dates in India-friendly format, and an empty state.

### REQ-2.2 Public visibility rules

Public APIs return announcements only when:

- The event is published and publicly readable.
- Announcement status is `PUBLISHED`.
- `published_at` is not in the future.

Draft, scheduled, and archived records, internal IDs for users, audit metadata, and notification history must not appear in public responses.

### REQ-2.3 Event detail preview

The public event detail page shows a “Latest updates” section when published announcements exist. It displays the pinned announcement and/or the newest two announcements, plus a “View all announcements” link.

No empty announcement card is shown when an event has never published an announcement.

### REQ-2.4 Sharing

Each published announcement has a copy/share action using a stable URL. Sharing text contains the announcement title, event name, and public URL. The canonical content remains the public page.

### REQ-2.5 Participant dashboard updates

Authenticated participants see organizer messages for events where their account has a confirmed or checked-in registration. Messages from unrelated events must never appear in this view.

Each dashboard update identifies the organizer and event, shows the published message, and provides clear links to the event and its complete announcement history. The announcement history page provides a back-to-event link.

## 3. Organizer experience

### REQ-3.1 Announcement workspace

The existing event Communications route adds an Announcements section containing:

- Published, scheduled, draft, and archived counts.
- Announcement list with status, title, updated/published time, pinned state, and actions.
- Create announcement action.
- Public-page preview/open action.

Announcement management is available for free and paid events. Email distribution remains subject to the existing communications feature entitlement.

### REQ-3.2 Editor

The editor supports title, body, publication choice, optional schedule time, and preview. It clearly distinguishes:

- Save draft.
- Publish now.
- Schedule.
- Archive.

Publishing is never implied by saving. Destructive actions require confirmation where data would disappear from the public page.

### REQ-3.3 Editing published announcements

Organizers may correct a published announcement. The public page shows the latest saved content and an “Updated” timestamp when it differs materially from publication time. Every published-content edit creates an audit record with before/after metadata or a safe diff summary.

### REQ-3.4 Event state behavior

- Draft events may have drafts but cannot publish public announcements.
- Published events may publish announcements.
- Archived events preserve their announcements in organizer history, but the existing public-event visibility rule removes the archived event and its announcements from public responses. Organizers cannot create or publish new announcements until the event is restored.
- Deleted events follow the existing event deletion/archive policy; announcement foreign keys and cleanup must not expose orphaned public content.

## 4. Scheduling

### REQ-4.1 Schedule validation

`scheduled_for` must be in the future and stored in UTC. The organizer UI displays and accepts time in the user's local timezone, defaulting to Asia/Kolkata for India-oriented formatting.

### REQ-4.2 Publication worker

Scheduled announcements become published through an idempotent background/recovery process. Repeated runs must not publish twice or duplicate downstream notifications.

The public read query may treat a due scheduled record as unpublished until the worker transitions it; this keeps status and audit history explicit.

## 5. Optional distribution

### REQ-5.0 Mobile push updates

- Registered participants may opt in to web push updates for an event from the public announcements page.
- Permission is requested only after an explicit user tap. On iOS/iPadOS, the UI explains that the site must first be added to the Home Screen.
- Subscriptions are tied to the authenticated user and event and require a confirmed or checked-in registration (admins and organizers may test the flow).
- Published announcements are delivered through VAPID when configured. Expired endpoints are disabled automatically and delivery errors never roll back publication.
- Payloads contain the announcement title, a short body, and a deep link to the public announcement page.

### REQ-5.1 Email distribution

After an announcement is published, an organizer may explicitly send its link to current event registrants using the existing broadcast email service. The action shows recipient count and delivery summary.

Publishing alone does not send email. Editing an already published announcement does not resend email automatically.

### REQ-5.2 WhatsApp sharing

The organizer may generate a WhatsApp share message containing the announcement title and public link. SportPass does not send WhatsApp messages directly in MVP.

### REQ-5.3 Delivery idempotency

An email send operation uses the announcement ID and send-attempt ID as idempotency/audit references. Retrying a failed operation must not create duplicate successful delivery records for the same recipient and attempt.

## 6. Authorization, privacy, and safety

### REQ-6.1 Authorization

Organizer mutations use the existing backend event ownership check. Admins may manage any event announcement. Frontend route guards are not a security boundary.

### REQ-6.2 Content safety

- Accept plain text only for MVP.
- Escape content before HTML email or web rendering.
- Disallow scripts, embeds, raw HTML, and arbitrary external image markup.
- Apply request size limits and publication rate limits.
- Never include participant lists, payment references, private registration fields, or organizer verification documents in public responses.

### REQ-6.3 Audit

Create, publish, schedule, edit-published, pin/unpin, archive, restore, delete-draft, and distribution actions are auditable. Audit metadata stores identifiers and safe summaries, not full participant data.

## 7. Accessibility and responsive behavior

- Public and organizer announcement screens must work at 320px width without page-level horizontal overflow.
- Status is conveyed with text, not color alone.
- Editor fields have labels and validation messages.
- Announcement headings follow a logical hierarchy.
- Keyboard users can create, publish, archive, and navigate announcements.
- Dates use semantic time elements where practical.

## 8. Non-goals for MVP

- Comments, reactions, or participant replies.
- Read receipts per participant.
- SMS or direct WhatsApp sending.
- Arbitrary HTML or file attachments.
- Audience segmentation beyond public visibility and optional all-registrant email distribution.
- Multi-language announcement translations.
- Real-time WebSocket updates.

## Acceptance criteria

1. An organizer can create a draft, preview it, publish it, and see it on the public page.
2. A public visitor cannot retrieve drafts, scheduled, or archived announcements.
3. The event page displays recent published updates without exposing organizer controls.
4. Pinning is atomic and never produces two pinned public announcements for an event.
5. A published announcement can be corrected with an updated timestamp and audit record.
6. An archived event cannot publish a new announcement.
7. Scheduled publication is idempotent.
8. Optional email distribution requires a separate explicit action and uses existing email limits/logging.
9. Mobile and desktop layouts pass the existing overflow and route E2E checks.
10. A participant can explicitly enable and receive a push notification for a newly published announcement.
