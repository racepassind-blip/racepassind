# Sport isolation audit (before implementation)

## Findings

There is no backend sport adapter, base interface, or registry. `Event.category`
is the persisted sport string; organizer APIs call it `sport`. It is not an enum.
The frontend `data/sportConfig.ts` is a capability map (running, cycling,
badminton, tennis, squash); `results/ResultAdapter.tsx` selects one of two result
views by that map. Neither is an end-to-end sport adapter. Table Tennis is only
advertised in OrganizerInfo; it is missing from the creation selector and map.
Trekking is stored as `hiking` and falls through to generic defaults.

## Flow audit

| Flow | Current implementation | Isolation finding |
| --- | --- | --- |
| Event/category create and edit | `app/schemas/events.py`, `api/v1/events.py`, `OrganizerEventCreate.tsx` | Distance exemption hardcoded to Badminton twice; frontend capability map disagrees for tennis/squash. Legacy event distance defaults to literal badminton. |
| Registration/participants/teams | `registration_service.py`, `registration_config_service.py`, `schemas/registrations.py`, `Checkout.tsx`, `OrganizerManualParticipant.tsx` | Category-driven singles/doubles/team cardinality and configurable participant fields; no Badminton-specific registration validation exists. Rules need an adapter extension point, persistence/contact/payment infrastructure can stay shared. |
| Payments, seats, manual confirmation | registration/payment services, organizer routes | Generic inventory, status, payment verification and permissions. Trekking uses these same flows; no separate trekking implementation. |
| Scheduling/fixtures | `match_service.py`, `tournament_round_service.py`, `matches.py`, `tournament_rounds.py`, `deps.py` | Generic category-scoped storage and round ordering; tournament guard only allows badminton or team entries. Team player selection assumes singles/doubles. |
| Match scoring/results | `match_service.py`, `schemas/matches.py`, OrganizerEventMatches/ScoringConfig | Global 2-games/21-points defaults, 30-point transport/UI limit, generic explicit winner and bout-majority logic. These are reusable policies, not universally correct sport rules. |
| Standings | `match_service.compute_standings`, TeamStandingsCard | Shared win/draw/loss aggregation with category configuration and global 3/1/0 fallback. No sport dispatch. |
| Race results | `race_result_service.py`, `race_results.py`, OrganizerEventRaceResults | Running/cycling share persistence/ranking. Cycling branch selects speed; every other sport implicitly gets pace. Public endpoint lacks sport gate. |
| Public pages/serialization | `public_events.py`, `ResultAdapter.tsx`, PublicRaceTimeResults, EventDetail | Result router loads match results even for races. Race metric display branches on cycling. Number labels duplicated with allocation endpoint. Generic event/registration serializers are safe shared contracts. |
| Allocation | `api/v1/allocations.py`, `public_events.py` | Separate sport maps and substring fallbacks can diverge. |

Badminton's flow exists but has shared defaults. Table Tennis's full advertised
flow is not wired. Running and Cycling are separate from match persistence but
not from each other's metric selection. Trekking's generic seat/payment flow
exists. Static marketing labels, card colors, and asset names are presentation
content, not behavior dispatch; these do not need adapter methods.

## Historical scoring table

`BadmintonCategoryScoring` / `badminton_category_scoring` stores only event,
category, games-to-win and points-per-game, uniquely by category. It is generic
game-scoring storage despite its historical name. Existing rows and match score
snapshots must remain authoritative. Do not rename/migrate this table just for
architecture. Select defaults and validation via a tournament policy owned by
the selected sport. Tennis's existing simplified game scoring is not a full
implementation of tennis scoring; this refactor must not invent one.

## Minimal refactor

1. Add `app/sports/base.py`, `registry.py`, independent sport definitions and
   reusable, sport-neutral tournament policies. Resolve `Event.category` through
   the registry, including table-tennis/table_tennis and hiking/trekking aliases.
2. Delegate category distance, registration cardinality hooks, capability gates,
   game defaults/normalization, bout winner, standings points, race calculation
   and display, and allocation labels. Keep authentication, payments, inventory,
   notifications, generic CRUD, round ordering, fixture storage and generic
   response envelopes shared.
3. Extend the frontend configuration with Table Tennis/Trekking and metric
   capabilities, centralize creation options, remove sport conditionals from
   functional pages, and route public results using event metadata.
4. Preserve unknown/legacy loading and persisted scoring. No new sport or schema
   migration. Add contract, dispatch, persistence and frontend regression tests.

Exact existing modules needing edits: backend `app/schemas/events.py`,
`app/api/deps.py`, `app/api/v1/{events,allocations,public_events,race_results}.py`,
`app/services/{registration_service,match_service,race_result_service}.py`;
frontend `data/sportConfig.ts`, `pages/{OrganizerEventCreate,
OrganizerEventTournament,OrganizerEventRaceResults}.tsx`,
`components/OrganizerScoringConfig.tsx`,
`results/{ResultAdapter,PublicRaceTimeResults}.tsx`.

## Guarantee boundary

Independent sport policies prevent changes to one sport implementation from
being invoked by another. Shared infrastructure and explicitly reused generic
policies remain shared dependencies and require regression tests; no architecture
can guarantee that arbitrary changes to shared code cannot break a sport.
Browser/payment-provider end-to-end verification is distinct from local service
and contract tests. This report records code findings, not a claim that those
external flows were exercised.

## Implemented result

- `app/sports/base.py`: frozen adapter contract for distance/category validation,
  registration cardinality, tournament capabilities, number labels, race metrics
  and race-specific display. `registry.py` is the sole sport selection point.
- Independent backend definitions: `badminton.py`, `table_tennis.py`, `running.py`,
  `cycling.py`, `trekking.py`. Tennis/squash and legacy distance sports use explicit
  registry configurations of the same contract. No sport implementation imports
  another sport implementation.
- `tournament.py` is an explicitly reusable game/bout policy: score limits,
  game normalization, player selection, explicit winner validation, bout majority
  and standings points. Persisted configuration always wins over defaults.
  Table Tennis defaults to 11 points; old stored 21-point configurations still load.
- All registration creation paths (single guest, batch, manual) select the event's
  registration policy. Generic configurable fields and payment rules stay shared.
- Organizer tournament guards now select capabilities consistently, including
  bout/team-scoring endpoints. Public non-tournament results no longer query matches.
- Frontend `sports/*.ts` contains independent configuration modules and a shared
  type contract; `data/sportConfig.ts` remains the registry API. Creation options,
  aliases, scoring limits, metric columns and public result routing use it.
- No Cricket implementation, event data migration, or scoring-table rename.

Generic category entry formats, contact validation, date-range validation,
fixture ownership checks, round ordering, time parsing, finish-time ranking,
win/draw/loss aggregation and response envelopes are intentionally shared,
not Badminton/Running implementations. New rules specific to a sport must be
implemented in that sport's adapter or its own policy, not in these utilities.
Existing tennis/squash simplified scoring is preserved, not upgraded to complete
sport rule engines. Tournament winners remain organizer-selected as before.

## Verification

Backend regression run with an isolated local SQLite database and automatic
migrations disabled: **104 passed, 6 skipped**, plus **9 subtests passed**.
New tests cover all configured sport create/edit/registration round-trips,
unknown legacy event serialization, aliases, immutable contracts, adding a new
adapter, Badminton/Table Tennis independent defaults and saved settings, retained
match snapshots, both tournament fixture/score/public-result flows, Running and
Cycling save/publish/public calculations with the other sport's functions made
to fail if called, sport-specific registration dispatch, Trekking sold-out seats
and manual payment approval.

Frontend: **23 tests passed**, including six public result routing cases and
configuration isolation/contracts; production build passed. Full TypeScript
checking is still blocked by existing unrelated errors (refund response types,
ES library target/replaceAll, missing Checkout icon and communication settings).
No new errors remain in the adapter modules/tests. The first unisolated backend
run attempted the environment's remote database; the passing run used a temporary
SQLite database. PostgreSQL-only integration tests were skipped. No live payment
provider or browser registration was exercised.

## Adding a sport later

Add an independent backend adapter and register it; add its frontend configuration
and registry/creation option. Existing sports need no edits. Reuse generic
policies explicitly when their semantics fit; otherwise supply a sport-owned
policy. Adding new configuration input fields or a new result protocol still
requires generic contract/UI extension points—this change does not prebuild
Cricket registration, fixtures or scoring.
