# Requirements: Team Registration & Tournament

## Background

Event categories today support four entry formats: Individual/Singles, Doubles, Single, and Team. The Team format
currently accepts a fixed participant count (3, 4, or 5). This spec extends Team to support a flexible min–max
range, introduces a fully customisable per-category registration form that auto-loads when Team is selected, and
adds a team-vs-team tournament structure with a flexible point system.

---

## 1. Flexible team size (min–max range)

### REQ-1.1 Replace fixed team size with a min–max range
When `entry_type` is `"team"`, the organiser sets two values instead of one:
- **Min participants** — the minimum number of members required to submit a registration (≥ 2).
- **Max participants** — the maximum number of members allowed per entry (≤ 50; must be ≥ Min).

The existing `participants_per_entry` field (single integer) is replaced by `team_size_min` and
`team_size_max` columns on `event_categories`.

### REQ-1.2 Ticket price and inventory count per complete team
One ticket represents one complete team entry regardless of how many members are in the 2–50 range.
`Ticket.price` and `Ticket.quantity_total` semantics are unchanged.

### REQ-1.3 Registration form enforces the range
- The "Add participant" button is hidden once the member count reaches `team_size_max`.
- The submit / "Continue to payment" button is disabled while the member count is below `team_size_min`.
- A counter label (e.g. "4 of min 3 – max 8 members added") is shown at all times during checkout.

### REQ-1.4 Backwards compatibility
The existing `participants_per_entry` column must remain populated (set to `team_size_min`) so that legacy
API consumers and the `_entry_size()` helper continue to work until a separate cleanup migration is done.

---

## 2. Dynamic form builder

### REQ-2.1 Auto-load default template on Team entry format
When the organiser selects `Entry Format = Team` in the category creation wizard, the participant form
builder (Step 4 "Participant form") automatically switches to a **two-section template** specific to team
registration. The existing single-section "field editor" is preserved for Singles and Doubles.

### REQ-2.2 Two-section structure
The template is split into two logical sections:

**Section A — Main registrant fields** (collected once per team, attributed to the captain / primary
registrant):

| Field ID | Label | Type | Required |
|---|---|---|---|
| `team_name` | Team name | text | required |
| `captain_name` | Captain name | text | required |
| `captain_phone` | Captain phone | phone | required |
| `captain_email` | Captain email | email | required |

**Section B — Per-participant fields** (one set of responses collected per team member row):

| Field ID | Label | Type | Required |
|---|---|---|---|
| `full_name` | Full name | text | required |
| `date_of_birth` | Date of birth | date | required |
| `blood_group` | Blood group | dropdown (A+, A−, B+, B−, O+, O−, AB+, AB−) | optional |
| `jersey_size` | Jersey size | dropdown (XS, S, M, L, XL, XXL) | optional |

### REQ-2.3 Full organiser editability
For both sections the organiser can:
- **Delete** any default field (except `team_name` in Section A and `full_name` in Section B, which are
  always required).
- **Reorder** fields via drag-and-drop or up/down arrow buttons.
- **Add a custom field** via "+ Add field". Each custom field requires:
  - Label (text, required)
  - Type: `text`, `date`, `dropdown`, or `number`
  - Required / optional toggle
  - For `dropdown` type: a comma-separated list of options

### REQ-2.4 Custom field limits
Up to 10 custom fields are allowed across both sections combined (relaxed from the current 5-field limit
for single-section events).

### REQ-2.5 Non-team entry formats are unaffected
When `entry_type` is `"singles"` or `"doubles"`, the existing single-section field editor behaviour is
preserved exactly as today.

### REQ-2.6 Persistence in `field_config`
Section A and Section B field lists are stored in the event's `field_config` JSON under two keys:
`"main_registrant_fields"` and `"participant_fields"`. The existing `"fields"` key is retained for
non-team events to preserve backwards compatibility.

---

## 3. Team registration checkout (public-facing)

### REQ-3.1 Two-phase form layout
The checkout (Step 1 "Participant details") for a team entry renders in two phases:
1. **Phase 1 — Team info:** Section A fields (team name, captain details). Shown once per entry.
2. **Phase 2 — Member roster:** Section B fields repeated for each member. Members are added one at a
   time with an "Add member" button. Each member's row is collapsible once marked complete.

### REQ-3.2 Participant count enforcement at checkout
- The "Continue to payment" / "Submit" button is disabled if the current member count < `team_size_min`.
- The "Add member" button is disabled (hidden) if the current member count = `team_size_max`.
- A progress label "N members added (min M, max X)" is shown above the roster.

### REQ-3.3 Data submission shape
The batch registration payload retains the existing `entries[].participants[]` array. For a team entry:
- `participants[0].responses` holds Section A fields (team name, captain details) plus `full_name` for
  the captain as the primary participant.
- `participants[1..N].responses` holds Section B fields for each additional member.

The backend service enforces that `team_size_min ≤ len(participants) ≤ team_size_max` for team tickets.

### REQ-3.4 Organiser dashboard — team roster view
The registration detail view (organiser dashboard) displays Section A data (team name, captain) at the top
and each member's Section B data in a collapsible table below.

---

## 4. Team-vs-team tournament structure

### REQ-4.1 Matches between team registrations
A match pairs two confirmed team registrations (Team A vs Team B). The existing `Match` model's
`entry_a_registration_id` and `entry_b_registration_id` already refer to `Registration` rows and therefore
work for team entries without schema changes.

### REQ-4.2 Flexible point system
The organiser configures a point-scoring rule per category (separate from the existing
`BadmintonCategoryScoring` which is badminton-only). The new `TeamMatchScoring` model stores:
- `points_for_win` (default 3)
- `points_for_draw` (default 1)
- `points_for_loss` (default 0)

### REQ-4.3 Any-player matchup within a team match
Within a match, the organiser can create one or more **individual bouts**: any player from Team A against
any player from Team B. Each bout is recorded as a child record linked to the parent team match. The team
match winner is determined either:
- **By bout majority** (most bouts won decides the match winner), or
- **Manually** set by the organiser directly on the match.

### REQ-4.4 Court assignment
Team matches can be assigned to a court (existing `Court` model). A single team match may span multiple
courts if multiple bouts run simultaneously — this is tracked at the bout level, not the match level.

### REQ-4.5 Tournament round support
Team categories use the existing `TournamentRound` model (round name + position). The badminton-only guard
on the courts, rounds, and matches APIs must be removed or replaced with a sport-agnostic check so team
events can use the same infrastructure.

### REQ-4.6 Standings calculation
A standings table is computed per category from all completed matches. Each team's record shows:
matches played, wins, draws, losses, bouts won, bouts lost, and total points. Tie-breaking uses points
first, then bouts won, then bouts conceded.

### REQ-4.7 Public results page
Completed matches and current standings are readable from the public event results page without
authentication, consistent with how individual match results are already surfaced today.

---

## 5. Non-goals (out of scope for this spec)

- Automated bracket seeding or draw generation (matches remain manually created by the organiser).
- Online payment gateway changes (manual UPI flow is unchanged).
- Notifications or email confirmations for team match scheduling.
- Native mobile app changes.
