# Design: Team Registration & Tournament

## 1. Database schema changes

### 1.1 `event_categories` — new columns

```sql
ALTER TABLE event_categories
  ADD COLUMN team_size_min INTEGER NULL,
  ADD COLUMN team_size_max INTEGER NULL;
```

- Both columns are `NULL` for `singles` and `doubles` categories.
- For `team` categories: `team_size_min >= 2`, `team_size_max <= 50`, `team_size_max >= team_size_min`.
- `participants_per_entry` is kept and set to `team_size_min` on every write so existing helpers
  (`_entry_size()`, serialisers) continue to return a sensible value without modification.

**SQLAlchemy model additions** (`backend/models.py` — `EventCategory`):
```python
team_size_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
team_size_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

Migration: `0028_team_size_range.py`

---

### 1.2 `team_match_scoring` — new table

Stores the flexible point rules per category (sport-agnostic replacement / companion to
`BadmintonCategoryScoring`).

```sql
CREATE TABLE team_match_scoring (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID NOT NULL REFERENCES events(id),
    category_id UUID NOT NULL REFERENCES event_categories(id),
    points_for_win   INTEGER NOT NULL DEFAULT 3,
    points_for_draw  INTEGER NOT NULL DEFAULT 1,
    points_for_loss  INTEGER NOT NULL DEFAULT 0,
    winner_by        VARCHAR(20) NOT NULL DEFAULT 'bouts',  -- 'bouts' | 'manual'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (category_id)
);
```

Migration: `0029_team_match_scoring.py`

---

### 1.3 `match_bouts` — new table

A **bout** is a single player-vs-player contest inside a team match.

```sql
CREATE TABLE match_bouts (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id                 UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    event_id                 UUID NOT NULL REFERENCES events(id),
    court_id                 UUID REFERENCES courts(id) ON DELETE SET NULL,
    -- players: any member of the entry's RegistrationParticipant set
    player_a_reg_participant_id  UUID REFERENCES registration_participants(id) ON DELETE SET NULL,
    player_b_reg_participant_id  UUID REFERENCES registration_participants(id) ON DELETE SET NULL,
    -- free-text fallback when participant rows aren't yet linked
    player_a_name            VARCHAR(160),
    player_b_name            VARCHAR(160),
    status                   VARCHAR(30) NOT NULL DEFAULT 'scheduled',  -- scheduled | in_progress | completed
    winner                   VARCHAR(20),  -- 'player_a' | 'player_b' | 'draw' | NULL
    score_a                  INTEGER,
    score_b                  INTEGER,
    scheduled_time           TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_match_bouts_match_id ON match_bouts(match_id);
CREATE INDEX ix_match_bouts_event_id ON match_bouts(event_id);
```

Migration: `0030_match_bouts.py`

---

### 1.4 `matches` — additional column

```sql
ALTER TABLE matches
  ADD COLUMN winner_by VARCHAR(20);  -- 'bouts' | 'manual' | NULL (inherits from TeamMatchScoring)
```

For team categories the `winner` field (`'entry_a'` / `'entry_b'`) is either computed automatically from
bout majority or set manually by the organiser. For non-team categories the column is ignored.

Migration: `0030_match_bouts.py` (same migration file).

---

## 2. Backend — schema (Pydantic) changes

### 2.1 `RaceCategoryCreateIn` / `OrganizerCategoryUpdateIn` (`app/schemas/events.py`)

Replace the fixed team-size validator:

```python
# Before
if self.entry_type == "team" and self.participants_per_entry not in {3, 4, 5}:
    raise ValueError("Team categories must have exactly 3, 4, or 5 participants")

# After
team_size_min: int | None = Field(default=None, ge=2, le=50)
team_size_max: int | None = Field(default=None, ge=2, le=50)

@model_validator(mode="after")
def validate_entry_format(self):
    if self.entry_type == "team":
        if self.team_size_min is None or self.team_size_max is None:
            raise ValueError("Team categories require team_size_min and team_size_max")
        if self.team_size_min > self.team_size_max:
            raise ValueError("team_size_min must be <= team_size_max")
        # keep participants_per_entry in sync for legacy callers
        self.participants_per_entry = self.team_size_min
    elif self.entry_type == "singles":
        self.participants_per_entry = 1
    elif self.entry_type == "doubles":
        self.participants_per_entry = 2
    return self
```

### 2.2 `field_config` shape

`normalize_field_config()` in `app/services/registration_config_service.py` is extended to recognise the
two new top-level keys:

```json
{
  "fields": [...],                    // legacy / non-team — unchanged
  "main_registrant_fields": [...],    // team: Section A
  "participant_fields": [...]         // team: Section B
}
```

Validation rules for each section follow the same `ParticipantFieldConfig` item shape used today
(`id`, `label`, `type`, `required`, `predefined`, `order`, `options?`).

Default values injected by `normalize_field_config` when `main_registrant_fields` / `participant_fields`
keys are absent:

**`main_registrant_fields` defaults:**
```json
[
  {"id":"team_name",     "label":"Team name",     "type":"text",  "required":true,  "predefined":true, "order":1},
  {"id":"captain_name",  "label":"Captain name",  "type":"text",  "required":true,  "predefined":true, "order":2},
  {"id":"captain_phone", "label":"Captain phone", "type":"phone", "required":true,  "predefined":true, "order":3},
  {"id":"captain_email", "label":"Captain email", "type":"email", "required":true,  "predefined":true, "order":4}
]
```

**`participant_fields` defaults:**
```json
[
  {"id":"full_name",    "label":"Full name",    "type":"text",     "required":true,  "predefined":true, "order":1},
  {"id":"date_of_birth","label":"Date of birth","type":"date",     "required":true,  "predefined":true, "order":2},
  {"id":"blood_group",  "label":"Blood group",  "type":"dropdown", "required":false, "predefined":true, "order":3,
   "options":["A+","A-","B+","B-","O+","O-","AB+","AB-"]},
  {"id":"jersey_size",  "label":"Jersey size",  "type":"dropdown", "required":false, "predefined":true, "order":4,
   "options":["XS","S","M","L","XL","XXL"]}
]
```

---

## 3. Backend — service changes

### 3.1 `registration_service.py` — `_entry_size()` and member count validation

`_entry_size(ticket)` continues to return `ticket.category.participants_per_entry` (= `team_size_min`),
used as the **minimum** valid count. A new helper `_max_entry_size(ticket)` returns
`ticket.category.team_size_max` (or `participants_per_entry` for non-team).

The member-count validation in `create_guest_batch_registration` changes for team entries from exact-match
to range-check:

```python
# Before
if len(entry.participants) != expected_members:
    raise ValueError(f"... requires exactly {expected_members} participants")

# After
min_size = _entry_size(ticket)
max_size = _max_entry_size(ticket)
count = len(entry.participants)
if count < min_size or count > max_size:
    if min_size == max_size:
        raise ValueError(f"... entry requires exactly {min_size} participants")
    raise ValueError(
        f"... entry requires between {min_size} and {max_size} participants"
    )
```

The same range-check is applied in `create_manual_registration`.

### 3.2 `registration_service.py` — Section A data handling

For team entries the batch payload includes Section A responses in `participants[0].responses`.
The Section A fields (`team_name`, `captain_name`, `captain_phone`, `captain_email`) are extracted and
stored in:
- `Registration.responses` — the top-level registration JSON (Section A only).
- `RegistrationParticipant[0].responses` — full combined responses for participant index 1 (captain).

`_participant_from_responses()` already maps `team_name` and `captain_name` → `Participant.name` /
`Participant.team_name` — no change needed. `captain_phone` and `captain_email` resolve the shared
contact for the entry.

### 3.3 `match_service.py` — team-match and bout CRUD

New functions added to `match_service.py`:

```
create_bout(db, user, event, match_id, payload) -> dict
update_bout(db, user, event, match_id, bout_id, payload) -> dict
delete_bout(db, event_id, match_id, bout_id) -> None
list_bouts(db, event_id, match_id) -> list[dict]
compute_match_winner_from_bouts(db, match) -> str | None
compute_standings(db, event_id, category_id) -> list[dict]
```

`serialize_match()` gains an optional `include_bouts: bool = False` parameter; when `True`, bouts are
eagerly loaded and included as `"bouts": [...]` in the response.

### 3.4 `match_service.py` — sport-agnostic guard

The `_require_badminton()` guard in `courts.py` and `tournament_rounds.py` is replaced with a general
`_require_tournament_sport(event)` check that passes for any sport where the organiser has enabled
tournament mode. For now, the allowed set is expanded to include all sports (the badminton restriction
was a UI convenience, not a data integrity rule). The guard is kept in the scoring endpoints that
genuinely depend on `BadmintonCategoryScoring`.

---

## 4. Backend — API endpoints

### 4.1 Existing endpoints — parameter additions

| Endpoint | Change |
|---|---|
| `POST /organizer/events` | `categories[].team_size_min`, `categories[].team_size_max` accepted in payload |
| `PUT /organizer/events/:id` | same |
| `GET /organizer/events/:id` | `teamSizeMin`, `teamSizeMax` added to category objects in response |
| `GET /events/:id` (public) | `teamSizeMin`, `teamSizeMax` added to `tiers[].category` in `TicketTierOut` |

### 4.2 New endpoints — team match scoring

```
GET  /organizer/events/:id/categories/:catId/team-scoring
PUT  /organizer/events/:id/categories/:catId/team-scoring
```

Request/response shape mirrors the existing badminton scoring endpoints, using `TeamMatchScoring` fields.

### 4.3 New endpoints — bouts

All under `/organizer/events/:eventId/matches/:matchId/bouts`:

```
GET    /                     list_bouts
POST   /                     create_bout
PUT    /:boutId               update_bout
DELETE /:boutId               delete_bout
```

### 4.4 New endpoint — standings

```
GET /organizer/events/:id/categories/:catId/standings
GET /events/:id/categories/:catId/standings           (public, read-only)
```

Response shape:
```json
[
  {
    "registrationId": "...",
    "teamName": "Tigers FC",
    "captainName": "Ravi Kumar",
    "matchesPlayed": 5,
    "wins": 3,
    "draws": 1,
    "losses": 1,
    "boutsWon": 14,
    "boutsLost": 8,
    "points": 10
  }
]
```

---

## 5. Frontend — organiser event creation wizard

### 5.1 `CategoryForm` interface additions (`OrganizerEventCreate.tsx`)

```typescript
interface CategoryForm {
  // ...existing fields...
  teamSizeMin: number | null;  // only used when entryType === "team"
  teamSizeMax: number | null;
}
```

`newCategory()` initialises `teamSizeMin: 3`, `teamSizeMax: 10` when `entryType` defaults to `"singles"`
(they are `null` until the user selects "Team"). `updateEntryType()` sets `teamSizeMin: 3`,
`teamSizeMax: 10` when switching to "Team".

### 5.2 Step 2 "Categories & Tickets" — team size UI

Replace the existing fixed-size `<Select>` (3/4/5) with two side-by-side number inputs:

```
Team size:  Min [ 3 ] — Max [ 10 ]  participants
(Ticket price and inventory count per complete team)
```

Validation in `validateStep(2)`: for team categories, `teamSizeMin >= 2`, `teamSizeMax >= teamSizeMin`,
`teamSizeMax <= 50`.

### 5.3 Step 4 "Participant form" — conditional two-section editor

The field editor panel detects whether **any** category in the event has `entryType === "team"`. If so,
it switches to the two-section layout:

```
┌─ Section A: Main registrant (team info) ─────────────────┐
│  [team_name ×] [captain_name ×] [captain_phone ×] [captain_email ×]  │
│  + Add field                                              │
└───────────────────────────────────────────────────────────┘
┌─ Section B: Per-participant fields ───────────────────────┐
│  [full_name ×] [date_of_birth ×] [blood_group ×] [jersey_size ×]     │
│  + Add field                                              │
└───────────────────────────────────────────────────────────┘
```

State is split: `mainRegistrantFieldEditors` and `participantFieldEditors` replace the single
`fieldEditors` array for team events. Both arrays use the same `ParticipantFieldEditor` type.

The `participantConfigPayload()` function emits:
```typescript
{
  main_registrant_fields: [...],
  participant_fields: [...],
  fields: []   // empty for team events, kept for schema compat
}
```

### 5.4 Drag-and-drop / reorder

Reorder is implemented using the existing pattern (up/down arrow buttons, same as current field editor)
for both sections. A drag-and-drop library is not introduced to keep the diff minimal.

---

## 6. Frontend — public checkout (`Checkout.tsx`)

### 6.1 Two-phase team checkout layout

When `tier.entryType === "team"`, Step 1 renders a two-phase layout instead of the current
participant-tab grid:

**Phase 1 — Team info card** (always visible, non-collapsible):
- Renders `main_registrant_fields` from `field_config.main_registrant_fields`.
- Stored in `riders[0]` (participant index 0, the captain).

**Phase 2 — Member roster**:
- One card per added member, collapsible once complete.
- An "Add member +" button appends a new blank member form (up to `tier.teamSizeMax`).
- A "Remove" button appears on each member card when count > `tier.teamSizeMin`.
- Progress label: `"N of min M – max X members added"`.

### 6.2 `TicketTierOut` additions (frontend type)

The `TicketTier` TypeScript type gains:
```typescript
teamSizeMin?: number | null;
teamSizeMax?: number | null;
```

These come from the backend `TicketTierOut` schema (updated to include category team-size fields).

### 6.3 Submit payload

The existing `entries[].participants[]` shape is used unchanged. Phase 1 responses map to
`participants[0].responses`; each Phase 2 member maps to `participants[1..N].responses`.

---

## 7. Frontend — tournament management pages

### 7.1 Courts and rounds — sport-agnostic availability

The frontend gating (`getSportConfig(sport).supports_tournament`) is extended so team-format events
automatically enable the tournament section in the organiser dashboard sidebar.

### 7.2 Match detail — bout management panel

In the match scoring page (`OrganizerMatchScoring` component), a new "Bouts" sub-panel appears below the
existing match header when `category.entryType === "team"`. It lists current bouts and provides:
- "Add bout" button → inline form: player from Team A, player from Team B, court (optional).
- Edit / delete per-bout row.
- Bout result entry: winner (player A / player B / draw) + optional score.

The match winner field becomes read-only when `winner_by === "bouts"` and shows the auto-computed value
based on bout majority.

### 7.3 Standings tab

A new "Standings" tab is added to `OrganizerEventTournamentResults.tsx`, rendering the standings table
from `GET /organizer/events/:id/categories/:catId/standings`. A public equivalent is added to the event
detail page results section.

---

## 8. Key data flows

### 8.1 Team category creation
```
Organiser fills wizard
  → Step 2: entryType="team", teamSizeMin=5, teamSizeMax=12
  → Step 4: edits Section A + Section B field lists
  → saveEvent() POST /organizer/events
  → Backend: EventCategory.team_size_min=5, team_size_max=12, participants_per_entry=5
             field_config.main_registrant_fields=[...], participant_fields=[...]
```

### 8.2 Public team registration
```
Participant picks ticket → checkout
  → Phase 1: fills team_name, captain_name, captain_phone, captain_email
  → Phase 2: adds N members (M ≤ N ≤ X), fills full_name, DOB, blood_group, jersey_size
  → Submit → POST /registrations/batch
  → Backend validates M ≤ count ≤ X
  → Creates Registration + N RegistrationParticipant rows
```

### 8.3 Match and bout lifecycle
```
Organiser creates match (Team A vs Team B)
  → POST /organizer/events/:id/matches
Organiser adds bouts
  → POST /organizer/events/:id/matches/:matchId/bouts  (×N)
Organiser scores bouts
  → PUT /organizer/events/:id/matches/:matchId/bouts/:boutId  { winner: "player_a" }
System auto-computes match winner (if winner_by="bouts")
  → PATCH match.winner = "entry_a" | "entry_b" | null (tie)
Standings recalculated on every match status change to "completed"
```

---

## 9. Migration plan

| Migration | File | Contents |
|---|---|---|
| 0028 | `0028_team_size_range.py` | Add `team_size_min`, `team_size_max` to `event_categories` |
| 0029 | `0029_team_match_scoring.py` | Create `team_match_scoring` table |
| 0030 | `0030_match_bouts.py` | Create `match_bouts` table; add `winner_by` to `matches` |

All migrations are additive (no destructive column drops). `participants_per_entry` remains populated for
the duration of this feature — a separate cleanup migration (`0031_drop_legacy_participants_per_entry.py`)
is deferred until the next major release cycle.
