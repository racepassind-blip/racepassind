# Tasks: Team Registration & Tournament

Implementation order follows the dependency chain: database → backend models/schemas → backend
services/API → frontend. Each task is self-contained enough to review and merge independently.

---

## Phase 1 — Database migrations

### Task 1 — Migration 0028: team size range columns
**File:** `backend/migrations/versions/0028_team_size_range.py`

- Add nullable `INTEGER` columns `team_size_min` and `team_size_max` to `event_categories`.
- Backfill: for existing rows where `entry_type = 'team'`, set both columns to
  `participants_per_entry`.
- No downgrade data-loss risk; downgrade simply drops both columns.

```python
# upgrade skeleton
op.add_column("event_categories", sa.Column("team_size_min", sa.Integer(), nullable=True))
op.add_column("event_categories", sa.Column("team_size_max", sa.Integer(), nullable=True))
op.execute("""
    UPDATE event_categories
    SET team_size_min = participants_per_entry,
        team_size_max = participants_per_entry
    WHERE entry_type = 'team'
""")
```

**Acceptance:** `alembic upgrade head` completes without error; existing team category rows have
non-null `team_size_min` / `team_size_max`; non-team rows remain NULL.

---

### Task 2 — Migration 0029: `team_match_scoring` table
**File:** `backend/migrations/versions/0029_team_match_scoring.py`

Create table with columns: `id`, `event_id` (FK → events), `category_id` (FK → event_categories,
UNIQUE), `points_for_win` (default 3), `points_for_draw` (default 1), `points_for_loss` (default 0),
`winner_by` (`VARCHAR(20)`, default `'bouts'`), `created_at`, `updated_at`.

Add indexes on `event_id` and `category_id`.

**Acceptance:** Table exists; unique constraint on `category_id` enforced.

---

### Task 3 — Migration 0030: `match_bouts` table and `matches.winner_by`
**File:** `backend/migrations/versions/0030_match_bouts.py`

1. Add nullable `VARCHAR(20)` column `winner_by` to `matches`.
2. Create `match_bouts` table:
   - `id` UUID PK
   - `match_id` UUID FK → matches(id) ON DELETE CASCADE
   - `event_id` UUID FK → events(id)
   - `court_id` UUID nullable FK → courts(id) ON DELETE SET NULL
   - `player_a_reg_participant_id` UUID nullable FK → registration_participants(id) ON DELETE SET NULL
   - `player_b_reg_participant_id` UUID nullable FK → registration_participants(id) ON DELETE SET NULL
   - `player_a_name` VARCHAR(160) nullable
   - `player_b_name` VARCHAR(160) nullable
   - `status` VARCHAR(30) NOT NULL DEFAULT `'scheduled'`
   - `winner` VARCHAR(20) nullable — `'player_a'` | `'player_b'` | `'draw'`
   - `score_a` INTEGER nullable
   - `score_b` INTEGER nullable
   - `scheduled_time` TIMESTAMPTZ nullable
   - `created_at`, `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()
3. Create indexes on `match_id` and `event_id`.

**Acceptance:** `match_bouts` table exists; `matches.winner_by` column exists; FK cascade from
`matches` to `match_bouts` works (delete a match → bouts deleted).

---

## Phase 2 — Backend models

### Task 4 — SQLAlchemy model updates
**File:** `backend/models.py`

1. **`EventCategory`**: add `team_size_min: Mapped[int | None]` and `team_size_max: Mapped[int | None]`.

2. **`Match`**: add `winner_by: Mapped[str | None] = mapped_column(String(20), nullable=True)`.
   Add relationship: `bouts: Mapped[list["MatchBout"]] = relationship(back_populates="match",
   cascade="all, delete-orphan", order_by="MatchBout.scheduled_time")`.

3. **New model `TeamMatchScoring`** (mirrors `BadmintonCategoryScoring` structure):
   ```python
   class TeamMatchScoring(Base):
       __tablename__ = "team_match_scoring"
       __table_args__ = (UniqueConstraint("category_id", name="uq_team_match_scoring_category"),)
       id, event_id, category_id
       points_for_win: Mapped[int]  # server_default="3"
       points_for_draw: Mapped[int]  # server_default="1"
       points_for_loss: Mapped[int]  # server_default="0"
       winner_by: Mapped[str]        # server_default="'bouts'"
       created_at, updated_at
       category: Mapped[EventCategory] = relationship(back_populates="team_scoring_config")
   ```
   Add back-reference `team_scoring_config` on `EventCategory`.

4. **New model `MatchBout`**:
   ```python
   class MatchBout(Base):
       __tablename__ = "match_bouts"
       id, match_id, event_id, court_id (nullable)
       player_a_reg_participant_id (nullable), player_b_reg_participant_id (nullable)
       player_a_name (nullable), player_b_name (nullable)
       status: Mapped[str]   # server_default="'scheduled'"
       winner: Mapped[str | None]
       score_a: Mapped[int | None], score_b: Mapped[int | None]
       scheduled_time: Mapped[dt.datetime | None]
       created_at, updated_at
       match: Mapped[Match] = relationship(back_populates="bouts")
       court: Mapped[Court | None] = relationship()
       player_a: Mapped[RegistrationParticipant | None] = relationship(foreign_keys=[...])
       player_b: Mapped[RegistrationParticipant | None] = relationship(foreign_keys=[...])
   ```

**Acceptance:** `python -c "from backend.models import TeamMatchScoring, MatchBout"` imports without
error; no new Alembic autogenerate diffs after running migrations.

---

## Phase 3 — Backend schemas and config service

### Task 5 — Pydantic schema updates for team size
**File:** `backend/app/schemas/events.py`

1. Add `team_size_min: int | None = Field(default=None, ge=2, le=50)` and
   `team_size_max: int | None = Field(default=None, ge=2, le=50)` to both
   `RaceCategoryCreateIn` and `OrganizerCategoryUpdateIn`.

2. Replace the existing team-size validator in both classes:
   - `"team"` entry type: require both `team_size_min` and `team_size_max`, validate
     `min <= max`, set `participants_per_entry = team_size_min`.
   - `"singles"`: set `participants_per_entry = 1`, null out min/max.
   - `"doubles"`: set `participants_per_entry = 2`, null out min/max.

3. Update the category response serialiser (in `app/api/v1/organizer.py` or wherever categories
   are serialised) to include `teamSizeMin` and `teamSizeMax` in the output dict.

4. Update `TicketTierOut` (in `backend/schemas.py` or the public events serialiser) to expose
   `teamSizeMin` and `teamSizeMax` from the linked category.

**Acceptance:** `POST /organizer/events` with `entry_type="team"`, `team_size_min=5`,
`team_size_max=12` creates an `EventCategory` row with correct values; sending `team_size_min=8`,
`team_size_max=5` returns HTTP 422.

---

### Task 6 — `field_config` two-section support
**File:** `backend/app/services/registration_config_service.py`

1. Extend `normalize_field_config(raw)` to:
   - Preserve existing `"fields"` key processing unchanged.
   - Accept and validate `"main_registrant_fields"` and `"participant_fields"` lists using the
     same `ParticipantFieldConfig` item schema.
   - If both new keys are absent but a caller passes `is_team=True`, inject the default Section A
     and Section B field lists described in the design doc.
   - Enforce: `team_name` cannot be removed from `main_registrant_fields`; `full_name` cannot be
     removed from `participant_fields`.
   - Cap total custom fields across both sections at 10.

2. The `normalize_event_configs()` wrapper called from `registration_service.py` is updated to pass
   `is_team=True` when `event.categories` contain a team-type category linked to the ticket.

**Acceptance:** Saving a team event with no `main_registrant_fields` in the payload auto-populates
the four default Section A fields; attempting to save with `team_name` removed from Section A
returns HTTP 422.

---

## Phase 4 — Backend services

### Task 7 — Registration service: range-based member count validation
**File:** `backend/app/services/registration_service.py`

1. Add helper `_max_entry_size(ticket: Ticket) -> int` returning
   `ticket.category.team_size_max if ticket.category else 1` (falls back to
   `participants_per_entry` when `team_size_max` is NULL for non-team tickets).

2. In `create_guest_batch_registration` and `create_manual_registration`, replace the
   exact-count check with a range check using `_entry_size()` (min) and `_max_entry_size()` (max).

3. Update the error message to show the range when `min != max`.

**Acceptance:** Submitting a team registration with fewer than `team_size_min` members returns
HTTP 422 with a descriptive message; submitting within the valid range succeeds; submitting above
`team_size_max` returns HTTP 422.

---

### Task 8 — Sport-agnostic tournament guard
**Files:** `backend/app/api/v1/courts.py`, `backend/app/api/v1/tournament_rounds.py`

1. Extract `_require_badminton(event)` from both files into a shared helper
   `_require_tournament_capable(event)` in `backend/app/api/deps.py` or a new
   `backend/app/api/v1/_tournament_guards.py` module.

2. Redefine the check: allow access if the event's sport is in an allowlist
   `{"badminton"}` **or** if the event has at least one `team` entry-type category.
   (This can be expanded later; for now badminton + team-format events are supported.)

3. Replace all `_require_badminton()` call sites in `courts.py` and `tournament_rounds.py` with
   `_require_tournament_capable()`. Leave the scoring-specific guard on
   `BadmintonCategoryScoring` endpoints untouched.

**Acceptance:** `GET /organizer/events/:id/courts` for a non-badminton event with a team category
returns HTTP 200 instead of HTTP 404.

---

### Task 9 — `match_service.py`: bout CRUD and standings
**File:** `backend/app/services/match_service.py`

1. **Bout serialiser** `_serialize_bout(bout: MatchBout) -> dict`:
   Returns `id`, `matchId`, `courtId`/`court`, `playerAName`, `playerBName`,
   `playerARegParticipantId`, `playerBRegParticipantId`, `status`, `winner`,
   `scoreA`, `scoreB`, `scheduledTime`, `createdAt`, `updatedAt`.

2. **`list_bouts(db, event_id, match_id)`**: query `MatchBout` filtered by `match_id` and
   `event_id`, ordered by `scheduled_time`, `created_at`.

3. **`create_bout(db, user, event, match_id, payload)`**:
   - Validate match belongs to event.
   - Validate player participant IDs (if provided) belong to the match's entry_a or entry_b
     registrations respectively.
   - Create `MatchBout` row; return serialised bout.

4. **`update_bout(db, user, event, match_id, bout_id, payload)`**:
   - Same validation as create.
   - When `status` transitions to `"completed"` and `winner_by="bouts"` on the parent match,
     call `_recompute_match_winner(db, match)`.

5. **`_recompute_match_winner(db, match)`**:
   Count `MatchBout` rows with `status="completed"` for the match; majority side wins.
   Update `match.winner` accordingly (`"entry_a"`, `"entry_b"`, or `None` for a tie);
   if all bouts are done, set `match.status = "completed"`.

6. **`compute_standings(db, event_id, category_id) -> list[dict]`**:
   - Load all `completed` matches for the category.
   - Load `TeamMatchScoring` config (or use defaults 3/1/0).
   - For each team registration, aggregate: wins, draws, losses, bouts won, bouts lost, points.
   - Sort by points DESC, bouts_won DESC, bouts_lost ASC.
   - Return serialised standings list (shape defined in design doc §4.4).

7. **`serialize_match()`**: add optional `include_bouts: bool = False` parameter; when True,
   include `"bouts": [_serialize_bout(b) for b in match.bouts]` in the response dict.

**Acceptance:** Creating two bouts for a match, scoring player_a wins both → `match.winner`
auto-sets to `"entry_a"` and `match.status` = `"completed"`; standings endpoint returns correct
point totals after multiple matches.

---

### Task 10 — Team match scoring service and API
**Files:** `backend/app/services/match_service.py`, `backend/app/api/v1/matches.py`

1. Add `get_or_create_team_scoring(db, event, category_id)` helper (mirrors
   `_scoring_config()` for badminton).

2. Add `update_team_scoring(db, event, category_id, payload)` to upsert `TeamMatchScoring`.

3. New router endpoints in `matches.py` (or a new `team_scoring.py` router):
   ```
   GET  /organizer/events/{event_id}/categories/{category_id}/team-scoring
   PUT  /organizer/events/{event_id}/categories/{category_id}/team-scoring
   ```
   Both require organiser authentication. Payload: `points_for_win`, `points_for_draw`,
   `points_for_loss`, `winner_by`.

4. Register the new router in `backend/app/main.py`.

**Acceptance:** `PUT` sets custom point values; subsequent standings computation uses the new values.

---

### Task 11 — Bout API endpoints
**File:** `backend/app/api/v1/matches.py` (add subrouter, or new file `bouts.py`)

```
GET    /organizer/events/{event_id}/matches/{match_id}/bouts
POST   /organizer/events/{event_id}/matches/{match_id}/bouts
PUT    /organizer/events/{event_id}/matches/{match_id}/bouts/{bout_id}
DELETE /organizer/events/{event_id}/matches/{match_id}/bouts/{bout_id}
```

Pydantic request schemas for create/update:
```python
class BoutCreateIn(BaseModel):
    player_a_reg_participant_id: UUID | None = None
    player_b_reg_participant_id: UUID | None = None
    player_a_name: str | None = Field(default=None, max_length=160)
    player_b_name: str | None = Field(default=None, max_length=160)
    court_id: UUID | None = None
    status: Literal["scheduled", "in_progress", "completed"] = "scheduled"
    winner: Literal["player_a", "player_b", "draw"] | None = None
    score_a: int | None = None
    score_b: int | None = None
    scheduled_time: dt.datetime | None = None

    @model_validator(mode="after")
    def require_player_identity(self):
        # each player needs either a participant ID or a name string
        ...
```

**Acceptance:** Full CRUD round-trip via the API; deleting the parent match cascades to bouts.

---

### Task 12 — Standings API endpoints
**File:** `backend/app/api/v1/matches.py` or new `standings.py` router

```
GET /organizer/events/{event_id}/categories/{category_id}/standings
GET /events/{event_id}/categories/{category_id}/standings   (public)
```

Organiser endpoint requires authentication. Public endpoint requires no auth and checks that the
event is published (same pattern as `list_public_match_results`).

**Acceptance:** Returns correct JSON after seeding test matches and bouts; unauthenticated access to
the public endpoint works; unauthenticated access to the organiser endpoint returns HTTP 401.

---

## Phase 5 — Frontend: organiser wizard

### Task 13 — `CategoryForm` and `OrganizerEventCreate.tsx`: team size range inputs
**File:** `frontend/src/pages/OrganizerEventCreate.tsx`

1. Add `teamSizeMin: number | null` and `teamSizeMax: number | null` to `CategoryForm`.

2. Update `newCategory()` → `teamSizeMin: null, teamSizeMax: null`.

3. Update `updateEntryType()`: when switching to `"team"` set `teamSizeMin: 3, teamSizeMax: 10`;
   when switching away set both to `null`.

4. In Step 2 JSX, replace the existing `<Select>` for team size (3/4/5) with two `<Input type="number">`
   fields side-by-side:
   ```tsx
   {category.entryType === "team" && (
     <div className="space-y-2">
       <Label>Team size</Label>
       <div className="flex items-center gap-3">
         <div className="flex-1 space-y-1">
           <p className="text-xs text-muted-foreground">Min</p>
           <Input type="number" min={2} max={50} value={category.teamSizeMin ?? ""} ... />
         </div>
         <span className="mt-5 text-muted-foreground">—</span>
         <div className="flex-1 space-y-1">
           <p className="text-xs text-muted-foreground">Max</p>
           <Input type="number" min={2} max={50} value={category.teamSizeMax ?? ""} ... />
         </div>
         <span className="mt-5 text-sm text-muted-foreground">participants</span>
       </div>
       <p className="text-xs text-muted-foreground">
         Ticket price and inventory count per complete team.
       </p>
     </div>
   )}
   ```

5. Update `validateStep(2)`: for team categories enforce `min >= 2`, `max >= min`, `max <= 50`.

6. Update the `saveEvent()` payload to send `team_size_min` and `team_size_max` instead of
   `participants_per_entry` for team categories.

7. When loading an existing event (`eventId` present), map `category.teamSizeMin/Max` from the API
   response into `CategoryForm`.

**Acceptance:** Wizard saves a team category with custom min/max; editing an existing event
re-populates the inputs correctly; trying to set max < min blocks the "Next" button.

---

### Task 14 — Two-section field editor for team events
**File:** `frontend/src/pages/OrganizerEventCreate.tsx`

1. Add state: `mainRegistrantFieldEditors: ParticipantFieldEditor[]` and
   `participantFieldEditors: ParticipantFieldEditor[]`.

2. Define default initialiser functions using the Section A and Section B defaults from the design
   doc (matching the predefined field IDs: `team_name`, `captain_name`, `captain_phone`,
   `captain_email` for Section A; `full_name`, `date_of_birth`, `blood_group`, `jersey_size` for
   Section B).

3. In Step 4 "Participant form", conditionally render:
   - **Has team category**: two labelled sections ("Team info (collected once)" and
     "Per-participant fields"), each with their own field list, reorder buttons, delete buttons,
     and "+ Add field" button.
   - **No team category**: existing single-section field editor unchanged.

4. Add `captain_name`, `captain_phone`, `captain_email` to the `PREDEFINED_FIELDS` array
   (they are new field IDs not present today).

5. Enforce: `team_name` row has no delete button in Section A; `full_name` row has no delete
   button in Section B.

6. Update `participantConfigPayload()` to emit `main_registrant_fields` and `participant_fields`
   when the event has a team category, and an empty `fields: []` for the legacy key.

7. When loading an existing team event, populate both field editor arrays from
   `event.fieldConfig.main_registrant_fields` and `event.fieldConfig.participant_fields`.

**Acceptance:** Saving a team event persists both section field lists; reloading the edit page
restores the field editor state; non-team events are unaffected.

---

## Phase 6 — Frontend: public checkout

### Task 15 — Two-phase team checkout in `Checkout.tsx`
**File:** `frontend/src/pages/Checkout.tsx`

1. Update the `TicketTier` TypeScript type to include `teamSizeMin?: number | null` and
   `teamSizeMax?: number | null`.

2. Detect team entry: `const isTeamEntry = activeTier?.entryType === "team"`.

3. When `isTeamEntry`, replace the current participant-tab grid in Step 1 with a two-phase layout:

   **Phase 1 — Team info** (always rendered, position = 0):
   - Renders fields from `event.fieldConfig.main_registrant_fields`.
   - Stored in `riders[0]` with `participantIndex = 0`.
   - Labelled "Team information".

   **Phase 2 — Member roster**:
   - Renders one collapsible card per member (indices 1…N).
   - "Add member +" button: appends a new blank `RiderDraft` with next `participantIndex`;
     disabled when count reaches `tier.teamSizeMax`.
   - "Remove" button on each member card: removes that draft; disabled when count would drop
     below `tier.teamSizeMin`.
   - Progress label above the roster: `"N members added (min M, max X)"`.
   - Uses `event.fieldConfig.participant_fields` for per-member field rendering.

4. `riderReady()` logic:
   - For `participantIndex = 0` (captain): validates Section A required fields + shared contact.
   - For `participantIndex >= 1` (members): validates Section B required fields only (no contact
     requirement for non-primary members).

5. `participantReady` gate: true only when Phase 1 is complete AND member count ≥ `teamSizeMin`
   AND all added member forms are complete.

6. The submit payload shape is unchanged: `entries[].participants[]` array with indices 0…N.

**Acceptance:** Can add between min and max members; submit blocked below min; add button disabled
at max; captain contact fields appear only on participant index 0; correct payload sent to API.

---

## Phase 7 — Frontend: tournament management

### Task 16 — Enable tournament tab for team-format events
**File:** `frontend/src/lib/sports.ts` (or wherever `getSportConfig` lives)

Update `getSportConfig(sport)` so that the `supports_tournament` flag is determined not only by
sport name but also accepts an optional `hasTeamCategories: boolean` parameter:

```typescript
function getSportConfig(sport: string, options?: { hasTeamCategories?: boolean }) {
  const base = SPORT_CONFIGS[sport.toLowerCase()] ?? DEFAULT_SPORT_CONFIG;
  return {
    ...base,
    supports_tournament: base.supports_tournament || Boolean(options?.hasTeamCategories),
  };
}
```

In the organiser dashboard layout / sidebar, pass `hasTeamCategories` derived from the event's
category list. This makes the Courts, Rounds, Matches, and Results tabs visible for any event with
a team category.

**Acceptance:** A non-badminton event with a `team` category shows the tournament sidebar tabs;
a non-badminton event with only `singles` categories does not.

---

### Task 17 — Bout management panel in match scoring page
**File:** `frontend/src/pages/OrganizerEventTournamentScoring.tsx` and
`frontend/src/components/OrganizerMatchScoring.tsx` (or wherever per-match scoring is rendered)

1. Add a "Bouts" card below the existing match header, rendered only when
   `match.category.entryType === "team"`.

2. The card lists existing bouts from `match.bouts` (fetched via
   `GET /organizer/events/:id/matches/:matchId/bouts` or included inline via
   `include_bouts=true` query param).

3. "Add bout" inline form:
   - Player A: searchable `<Select>` populated from `match.entryA.participantNames`.
   - Player B: searchable `<Select>` populated from `match.entryB.participantNames`.
   - Court: optional `<Select>` from event courts list.
   - Submit calls `POST .../bouts`.

4. Per-bout row (table):
   - Columns: Player A, Player B, Court, Status, Winner, Score A, Score B, Actions.
   - Inline edit: clicking a row opens an edit drawer/popover; save calls `PUT .../bouts/:boutId`.
   - Delete: calls `DELETE .../bouts/:boutId` with confirmation.

5. Match winner display:
   - When `match.winnerBy === "bouts"`: show computed winner read-only with label "Auto (bout majority)".
   - When `match.winnerBy === "manual"` (or null): show the existing winner `<Select>`.

**Acceptance:** Adding and scoring two bouts for a team match updates the match winner in the UI
without a page reload; organiser can override to manual winner when needed.

---

### Task 18 — Team match scoring configuration UI
**File:** `frontend/src/pages/OrganizerEventTournament.tsx`

Add a "Points system" card to the tournament setup page, shown when the selected category has
`entryType === "team"`:

```
Points for win   [ 3 ]
Points for draw  [ 1 ]
Points for loss  [ 0 ]
Winner decided by  ○ Bout majority  ○ Manual
```

On save, calls `PUT /organizer/events/:id/categories/:catId/team-scoring`.

**Acceptance:** Saving custom values persists to DB; reloading the page restores saved values;
standings use the updated point values.

---

### Task 19 — Standings tab
**Files:** `frontend/src/pages/OrganizerEventTournamentResults.tsx` and the public event results
section.

1. Add a "Standings" tab to `OrganizerEventTournamentResults.tsx` alongside the existing tabs.

2. Fetch `GET /organizer/events/:id/categories/:catId/standings` using TanStack Query.

3. Render a sortable table:

   | Team | P | W | D | L | BW | BL | Pts |
   |---|---|---|---|---|---|---|---|
   | Tigers FC | 5 | 3 | 1 | 1 | 14 | 8 | 10 |

   P = played, W = wins, D = draws, L = losses, BW = bouts won, BL = bouts lost, Pts = points.

4. Add a read-only equivalent to the public event results page using the public standings endpoint.

**Acceptance:** Standings table shows correct data after test matches are seeded; table is visible
to public users without auth.

---

## Phase 8 — Organiser dashboard: team roster view

### Task 20 — Registration detail view: team section display
**Files:** Organiser dashboard registration detail component (wherever individual registration
details are currently rendered — typically inside the registrations list or a modal/drawer)

1. Detect team registration: `registration.responses` contains `team_name` key.

2. Render a "Team information" section at the top showing Section A fields (team name, captain name,
   phone, email) from `registration.responses`.

3. Render a "Team members" section as a collapsible table. Each row represents one
   `RegistrationParticipant` (from `registration.participants[]`), showing their Section B
   field values (full name, DOB, blood group, jersey size) plus any custom fields.

4. Member rows are collapsible (click to expand full field values).

**Acceptance:** Opening a confirmed team registration in the organiser dashboard shows the team
name, captain details, and a roster table with all members' data.

---

## Dependency map

```
Task 1 (migration 0028)
Task 2 (migration 0029)
Task 3 (migration 0030)
    ↓
Task 4 (models)
    ↓
Task 5 (Pydantic schemas)   Task 6 (field_config service)
    ↓                            ↓
Task 7 (reg service range)  Task 8 (tournament guard)
    ↓
Task 9 (bout CRUD service)  Task 10 (team scoring service+API)
    ↓                            ↓
Task 11 (bout API)          Task 12 (standings API)
    ↓                            ↓
Task 13 (wizard team size)  Task 14 (two-section field editor)
    ↓                            ↓
Task 15 (checkout two-phase) Task 16 (tournament tab gate)
                                 ↓
                   Task 17 (bout panel)  Task 18 (scoring config UI)
                                              ↓
                                         Task 19 (standings tab)
                                              ↓
                                         Task 20 (roster view)
```

Tasks within the same phase with no arrows between them can be worked in parallel.
