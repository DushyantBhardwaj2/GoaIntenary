# Batch board — trip-planning half

**Opened:** 21 October 2026. Local implementation only. No deploy, push, pull request, or cloud resources.

**Decision:** `plan.md` still lists cloud Stage 0/1 ahead of later feature stages. This run implements the trip-planning half locally first. Cloud acceptance stays a separate gate.

**Baseline to keep:** web 15 tests, core 45 tests, discovery 51 tests, `places.json` 16 place ids. Do not edit `core.test.ts`, `planning.test.ts`, or `ledger.test.ts`. Do not edit migrations 001–003.

**Running locally:** web `http://127.0.0.1:3000`, core `http://127.0.0.1:4000`, discovery `http://127.0.0.1:4100`. Do not start a second `dev:local`.

## Waves

| Wave | Children | Status |
| --- | --- | --- |
| 0 | Contracts | Integrated. Migration 004, types, schemas, and empty stubs are in place. |
| 1 | Travel, Stays, Contacts | Integrated. Web 15 passed. Core 60 passed, 2 failed. The only failure is the frozen `planning.test.ts` version list `[1, 2, 3]` versus `[1, 2, 3, 4]`. |
| 2 | Checklists | Integrated. Eight checklist tests passed inside `npm test`. |
| — | Integrate batch 1, `npm test`, verifier, tester, one fix pass, then a `plan.md` status paragraph | Done. No fix pass. Status paragraph is in `plan.md`. |
| 3 | Votes, Comments, Bookings | Integrated. Web 15 passed. Core 91 passed, 2 failed. The only failure is the frozen `planning.test.ts` version list. |
| 4 | Budget limits (only after no other child has `planning-repository.ts` open) | Integrated. Budget-limit tests passed inside `npm test`. |
| — | Integrate batch 2, `npm test`, verifier, tester, one fix pass, then a `plan.md` status paragraph | Done. No product fix. Status paragraph is in `plan.md`. Phone layout for this batch was not checked. |
| 5 | Itinerary additions (after `BookingLinkPicker` and `ActivityComments` exist) | In progress |
| 6 | Today dashboard (mounts panels in `workspace.tsx`) | Waiting |
| — | Integrate batch 3, `npm test`, `npm run test:discovery`, typecheck, verifier, tester, one fix pass, `plan.md` status paragraph, stop | Waiting |

At most three children at once. Feature agents do not edit `plan.md`.

## Shared contract

Migration `services/core-api/migrations/004_trip_planning.sql` only. Append `'004_trip_planning.sql'` in `services/core-api/src/database.ts` and set `latestMigration = 4`. Do not change the slice logic.

Money is integer paise (`bigint`). Timestamps are `timestamptz`. API JSON is camelCase. SQL is snake_case. New path segments match `^[a-zA-Z0-9_-]+$`. Every new trip read and write calls `TripRepository.membership`. Pending, removed, and outsider actors get 404 `NOT_FOUND` with message `That resource is unavailable`. Organiser-only writes get 403 only after accepted membership.

Creates for travel, stay, booking, contact, and checklist accept the existing `Idempotency-Key` header. Core JSON bodies stay under 16 KB. Do not log booking references, phone numbers, or comment bodies.

`Budget` gains `forecastRemainingPaise` (`budgetPaise === null ? null : budgetPaise - plannedTotalPaise`) and `limitPaise: number | null` on each `categoryTotals` item. `remainingPaise` stays budget minus paid spending. Until the budget agent stores limits, `budget()` returns `limitPaise: null`.

**Orchestrator exception:** the contracts agent may add those two fields inside the existing `budget()` return and no other method in `planning-repository.ts`, so the type typechecks. The budget agent owns later limit storage and is still the only agent who may edit `budget()` after that.

**Frozen assertion:** `planning.test.ts` expects migration versions `[1, 2, 3]`. That file stays frozen. Wave 0 still applies version 4. If that snapshot is the only red assertion, record it here and do not edit the test.

## Travel

- **User-visible:** Accepted members add, edit, and remove flight, train, or bus segments with both times, terminals, travellers, notes, and a booking reference. The reference is stored and shown to members. It is not logged.
- **Acceptance:** Aman creates a flight with terminal text, two travellers, and a reference. Riya, once accepted, can read it. Dev, a pending member, and a removed member get 404. A repeat `Idempotency-Key` does not create a second segment. `arrivalAt` before `departureAt` is 400. Soft-delete hides it.
- **Owner:** Travel agent. `services/core-api/src/travel-routes.ts`, `travel-repository.ts`, `services/core-api/test/travel.test.ts`, `apps/web/src/components/travel-panel.tsx`, `travel.module.css`. Export `registerTravelRoutes` and `TravelPanel` (`{ tripId: string }`).
- **Data / API:** `goa_core_travel_segments`, `goa_core_travel_travellers`. `GET/POST /v1/trips/:tripId/travel`, `PATCH/DELETE /v1/trips/:tripId/travel/:segmentId`. POST includes `travellerIds`.
- **Depends on:** Wave 0 contract.
- **Permissions / failure:** Membership on every read and write. 404 before any organiser distinction. Validation 400. Idempotent create.
- **Test evidence:** `npx tsx --test --test-concurrency=1 test/travel.test.ts` — 1 passed, 0 failed. Reported by [Travel](28858174-d30c-45b0-b9fd-c5a686767046). Not yet part of the wave `npm test`.
- **Findings:** Panel is not mounted, which is expected until the dashboard wave. A repeated idempotency key after soft-delete returns 404 and does not insert a replacement. PATCH with an omitted optional field clears that field.

## Stays

- **User-visible:** Accommodation with property name, address, check-in, check-out, guests, property phone, contact name, notes, and a map pin only when both coordinates exist. A stay without coordinates still appears in the list. Confirmation references belong on the booking, not a new stay column.
- **Acceptance:** Create a stay, assign two guests, reject `checkOut <= checkIn`, reject a lone latitude, outsider and removed member 404, soft-delete hides it, idempotent create. `StaysPanel` lists stays. Pin only from `stay-map.tsx`.
- **Owner:** Stays agent. `stay-routes.ts`, `stay-repository.ts`, `stays.test.ts`, `stays-panel.tsx`, `stay-map.tsx`, `stays.module.css`. Export `registerStayRoutes` and `StaysPanel`.
- **Data / API:** `goa_core_stays`, `goa_core_stay_guests`. `GET/POST /stays`, `PATCH/DELETE /stays/:stayId`. POST includes `guestIds`. Tile URL `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with the existing OpenStreetMap attribution. No prefetch and no offline tiles.
- **Depends on:** Wave 0.
- **Permissions / failure:** Same membership rule. Paired coordinates. `check_out > check_in`.
- **Test evidence:** `npx tsx --test --test-concurrency=1 test/stays.test.ts` — 7 passed, 0 failed. Included in the wave `npm test` below. Reported by [Stays](444d6f53-1ac0-47f7-813b-e8c054d9e818).
- **Findings:** Panel is not mounted, which is expected until the dashboard wave. PATCH is a full replacement. A repeated idempotency key after soft-delete returns 404. Guest junction rows remain after a soft delete. The map is stay-only in `stay-map.tsx` and was not opened in a browser.

## Contacts

- **User-visible:** Organiser, hotel, driver, rental, and activity-provider phone cards. Phone renders as `<a href="tel:...">` when it contains at least 7 digits. The page stays on the trip. The contact role `organiser` is not a membership change.
- **Acceptance:** One card of each role. Unknown role rejected. A stay id from another trip rejected. Outsider and removed member 404. Soft-delete hides the card.
- **Owner:** Contacts agent. `contact-routes.ts`, `contact-repository.ts`, `contacts.test.ts`, `contacts-panel.tsx`, `contacts.module.css`. Export `registerContactRoutes` and `ContactsPanel`.
- **Data / API:** `goa_core_contacts`. `GET/POST /contacts`, `PATCH/DELETE /contacts/:contactId`. Optional `stayId` and `activityId` must belong to the same trip.
- **Depends on:** Wave 0. Optional stay and activity links need those rows to exist at runtime; the route can land in wave 1.
- **Permissions / failure:** Accepted members create and edit. 404 for non-members.
- **Test evidence:** `npx tsx --test --test-concurrency=1 test/contacts.test.ts` — 6 passed, 0 failed. Reported by [Contacts](d00629fc-6710-4da8-a3fb-b42f5cb5a455). Not yet part of the wave `npm test`.
- **Findings:** Panel is not mounted, which is expected until the dashboard wave. Reusing an idempotency key after soft-delete returns 404 and does not create a replacement. A contact already linked to a stay or activity keeps that link if the target is later soft-deleted. The UUID schema is case-sensitive; the panel lowercases stay and activity ids before save.

## Checklists

- **User-visible:** Personal packing and tasks, plus shared tasks with an assignee and completion. Personal rows stay visible only to their creator, including when the reader is the organiser.
- **Acceptance:** Aman creates a personal item Riya cannot read. Aman creates a shared item assigned to Riya. Riya completes it. Dev and a removed member get 404. The organiser's GET omits Aman's personal row.
- **Owner:** Checklists agent. `checklist-routes.ts`, `checklist-repository.ts`, `checklist.test.ts`, `checklist-panel.tsx`, `checklist.module.css`. Export `registerChecklistRoutes` and `ChecklistPanel`.
- **Data / API:** `goa_core_checklist_items`. `GET/POST /checklist`, `PATCH/DELETE /checklist/:itemId`. Assignee is an accepted member or null, and only on shared rows.
- **Depends on:** Wave 0. Runs alone in wave 2.
- **Permissions / failure:** Creator or organiser completion and delete rules as in the handoff. Personal items have a null assignee. On a shared item, only the assignee or the organiser can set `completedAt`. Someone else's personal item is 404.
- **Test evidence:** Checklist tests passed inside the wave 2 `npm test` (parent plus seven subtests, reported as 8). [Checklists](e97651af-e475-4ce0-81b2-3bfa98896a4e). The full run was green only while `planning.test.ts` had again been rewritten; that assertion was restored.
- **Findings:** Panel is not mounted, which is expected until the dashboard wave. It calls existing `GET /v1/me` to tell the creator, assignee, and organiser apart. A schema-invalid body can return 400 before membership. A repeated idempotency key after trim differences is treated as the same write.

## Votes

- **User-visible:** Interested votes on an already saved place, with count and voter names. One vote per member. Unsaving the place removes its votes.
- **Acceptance:** Aman and Riya both interested yields count 2 and both names. Aman voting twice stays one row. Withdrawing drops only Aman. An unsaved place id is 404. Dev and a removed member are 404. Unsave removes votes. Saved places tab shows count and names.
- **Owner:** Votes agent. `vote-routes.ts`, `vote-repository.ts`, `votes.test.ts`, and vote UI inside `saved-places.tsx` only. Export `registerVoteRoutes` and `removeVotesForPlace`. One call inside existing `unsavePlace`, with the comment `// votes: delete place votes with the save`. No other method in that file.
- **Data / API:** `goa_core_place_votes`. `GET /saved-places/:placeId/votes`, `PUT` body `{ interested: boolean }`. GET returns `{ count, voters: { userId, displayName }[] }`.
- **Depends on:** Wave 0. Saved places already exist.
- **Permissions / failure:** Accepted members. 404 otherwise. No rating.
- **Test evidence:** `npx tsx --test --test-concurrency=1 test/votes.test.ts` — 8 passed, 0 failed. Planner save, unsave, and budget subtests still passed. The frozen version-list assertion failed as expected. Reported by [Votes](c30b048c-927c-45da-9559-cf27c66ba91b). Not yet part of the wave `npm test`.
- **Findings:** `unsavePlace` deletes votes in the same transaction before the saved-place delete, with the required comment. The Saved places screen was not opened in a browser. A vote from a member who is later removed stays in the count until the place is unsaved.

## Comments

- **User-visible:** A flat thread per activity, newest last, with timestamps, own edit/delete, and organiser delete of any comment.
- **Acceptance:** Member creates, edits own, deletes own. Cannot edit another's. Organiser deletes another's. Dev and a removed member 404. Deleted comments disappear from GET. Empty body is 400.
- **Owner:** Comments agent. `comment-routes.ts`, `comment-repository.ts`, `comments.test.ts`, `activity-comments.tsx`, `comments.module.css`. Export `registerCommentRoutes` and `ActivityComments` (`{ tripId, activityId, organiser }`).
- **Data / API:** `goa_core_activity_comments`. Body 1–2000 trimmed characters. `GET/POST /activities/:activityId/comments`, `PATCH/DELETE /activities/:activityId/comments/:commentId`. Timestamps stored in UTC and labelled in Asia/Kolkata.
- **Depends on:** Wave 0. Activities already exist. Mounted later by the itinerary agent.
- **Permissions / failure:** Author PATCH/DELETE. Organiser DELETE. 403 after membership when authorship is known. Do not log the body.
- **Test evidence:** `npx tsx --test --test-concurrency=1 test/comments.test.ts` — 6 passed, 0 failed. Reported by [Comments](cb061a55-d31b-4465-8fb6-b8a1e0b3127d). Not yet part of the wave `npm test`.
- **Findings:** `ActivityComments` is not mounted on an activity card. A retried POST can create a second comment. Times are labelled in India time in the component. The thread was not opened in a browser.

## Bookings

- **User-visible:** One booking link on an activity, a stay, or a travel segment, with provider and reference. No file picker and no file column.
- **Acceptance:** Link each target type. A second live booking for the same target conflicts. A foreign trip's activity id is rejected. Dev and a removed member get 404. Soft-delete removes the link. No multipart parser.
- **Owner:** Bookings agent. `booking-routes.ts`, `booking-repository.ts`, `bookings.test.ts`, `bookings-panel.tsx`, `booking-link-picker.tsx`, `bookings.module.css`. Export `registerBookingRoutes`, `BookingsPanel`, and `BookingLinkPicker` (`{ tripId, targetType, targetId }`).
- **Data / API:** `goa_core_bookings`. `target_type` is `activity`, `stay`, or `travel`. One live row per `(trip_id, target_type, target_id)`. `GET/POST /bookings`, `PATCH/DELETE /bookings/:bookingId`.
- **Depends on:** Wave 0. Travel and stay routes exist before this wave, so bookings may start in wave 3.
- **Permissions / failure:** Accepted members. Target must be a live row on the same trip or the write is 400. Do not log the reference.
- **Test evidence:** `npx tsx --test --test-concurrency=1 test/bookings.test.ts` — 8 passed, 0 failed, included in the wave `npm test`. Reported by [Bookings](206dae34-d96c-473c-8725-a717feabacad).
- **Findings:** `BookingsPanel` and `BookingLinkPicker` are not mounted. There is no file column and a `file` property is rejected. The panels were not opened in a browser.

## Budget limits

- **User-visible:** Per-category spending caps and a forecast-remaining amount beside actual remaining. Over-limit rows are marked. Limits do not reject an expense or change split math.
- **Acceptance:** Organiser sets an accommodation limit. A member PUT gets 403. A removed member gets 404. GET `/budget` keeps old keys plus `forecastRemainingPaise` and `limitPaise`. Fixture budget 2_000_000, planned 800_000, paid 125_000 returns remaining 1_875_000 and forecast remaining 1_200_000.
- **Owner:** Budget agent. `budget-limit-routes.ts`, `budget-limit-repository.ts`, `budget-limits.test.ts`, `budget-overview.tsx`, and limit controls in `budget.tsx` only if needed. Export `registerBudgetLimitRoutes`. May edit `budget()` and no other method in `planning-repository.ts`.
- **Data / API:** `goa_core_budget_category_limits`. `PUT /budget/category-limits` organiser only, body `{ limits: { category, limitPaise }[] }`. Categories stay `accommodation|transport|food|activities|shopping|other`. A missing row is `limitPaise: null`.
- **Depends on:** Wave 0 fields. Runs alone in wave 4, after the votes agent has finished with `planning-repository.ts`.
- **Permissions / failure:** Members read. Organiser writes. 404 for non-members. 403 for an accepted non-organiser.
- **Test evidence:** `budget-limits.test.ts` passed inside the wave `npm test` (6 subtests). Ledger tests passed. The planning budget subtest still returns remaining 1_875_000. Reported by [Budget](11111480-45c8-4124-b659-dab44351feaf).
- **Findings:** The screen was not opened in a browser. A saved cap cannot be cleared back to no limit; 0 is a real zero cap. The PUT rate limit runs before membership, so a caller over the limit can receive 429 before 403 or 404. The vote-delete line in `unsavePlace` is still there.

## Itinerary additions

- **User-visible:** Activity status, attendee names, a booking link, and the comment thread on the plan. Cancelled activities stay in the list. Overlap warnings stay warnings.
- **Acceptance:** Set status confirmed. Replace attendees with two participant ids. A participant from another trip is rejected. Dev and a removed member 404. Cancelled activities still return in the activity list. The plan UI shows status, attendees, `BookingLinkPicker`, and `ActivityComments`.
- **Owner:** Itinerary agent. `activity-extra-routes.ts`, `activity-extra-repository.ts`, `activity-extras.test.ts`, `planner.tsx`, `activity-form.tsx`. Optional `activity-extras.tsx`. Export `registerActivityExtraRoutes`.
- **Data / API:** `goa_core_activity_status`, `goa_core_activity_attendees`. Missing status reads as `planned`. `GET/PUT /activities/:activityId/status` body `{ status }`. `GET/PUT /activities/:activityId/attendees` body `{ participantIds }`.
- **Depends on:** `BookingLinkPicker` and `ActivityComments`. Wave 5.
- **Permissions / failure:** Accepted members. Status `planned|confirmed|cancelled`. Attendees are expense-participant ids on this trip.
- **Test evidence:** Not run.
- **Findings:** None yet.

## Today dashboard

- **User-visible:** Today tab with today's activities, upcoming travel, stays, and contacts. No weather and no reminders. Existing tabs stay: The plan, Saved places, Budget & splits, Your people. New tabs: Today, Travel, Stays, Bookings, Contacts, Checklist.
- **Acceptance:** One activity today, one future flight, one current stay, and one contact return in those groups. A cancelled today activity is omitted. Dev and a removed member get 404. A trip with no rows returns empty arrays. Original four tabs still mount.
- **Owner:** Dashboard agent. `overview-routes.ts`, `overview-repository.ts`, `overview.test.ts`, `trip-overview.tsx`, `overview.module.css`, and tab mounts only in `workspace.tsx`. Export `registerOverviewRoutes` and `TripOverview`.
- **Data / API:** `GET /v1/trips/:tripId/overview` returns `{ today, upcomingTravel, stays, contacts }`. "Today" is the current date in Asia/Kolkata. `upcomingTravel` is soonest first, limit 5. Stays overlap today or check in next, limit 5.
- **Depends on:** Travel, stays, contacts, and activity status. Wave 6, last.
- **Query values:** `overview`, `travel`, `stays`, `bookings`, `contacts`, `checklist`. Votes stay inside Saved places. Comments and booking links stay inside the plan. Budget limits stay inside Budget & splits.
- **Test evidence:** Not run.
- **Findings:** None yet.

## Out of scope this run

Document uploads, receipts, PDF export, trip archiving, account controls, content administration, growing the catalogue, events, weather, reminders, notifications, and a visible change-history screen. Do not add fake weather or fake reminders. Do not attach file blobs to bookings.

## Next batch (do not implement)

After batch 3's tester finishes, record and stop: shared and private uploads, receipts, PDF export, trip archiving, and events, unless a tighter dependency-ready set is already in `plan.md`.

## Integration log

- 21 October 2026: Board opened. Local-first paragraph added to `plan.md`. Wave 0 contracts child started. No feature behavior yet.
- 21 October 2026, wave 0: [Contracts](ee9d802b-6d94-4917-8f89-40cffefe2bca) handed off migration 004, frozen camelCase types, Fastify schemas, and empty `register*Routes` stubs. `budget()` now returns `forecastRemainingPaise` (budget minus planned) and `limitPaise: null`. Core and web typechecks passed. The new migration test passed. Web tests stayed at 15 passed.
- Frozen finding, not a feature defect: `planning.test.ts` line 65 still expects migration versions `[1, 2, 3]`. After 004 the list is `[1, 2, 3, 4]`. The contracts child had rewritten that assertion to follow `latestMigration`. The orchestrator restored the original assertion. The file stays untouched from here. Every other subtest in that file passed, including the budget checks. This does not block wave 1.
- Orchestrator `npm test` before that restore: web 15 passed, core 48 passed, 0 failed. After the restore, `planning.test.ts` fails only on the version list (the subtest and its parent). New migration tests passed: version 4 is recorded once, and an old trip gains no votes, stays, or checklist rows.
- Integrator fix: the existing core BFF now also exports `PUT`, so the contracted vote, status, attendee, and category-limit writes can reach the core. No new BFF route file was added.
- 21 October 2026, wave 1 started: [Travel](28858174-d30c-45b0-b9fd-c5a686767046), [Stays](444d6f53-1ac0-47f7-813b-e8c054d9e818), and [Contacts](d00629fc-6710-4da8-a3fb-b42f5cb5a455) are writing disjoint files. Checklists waits until this wave is integrated.
- 21 October 2026: Contacts handed off. Six contact tests passed. Travel and stays are still writing. Web typecheck was reported red in `stay-map.tsx` while that file was still being edited; it stays with the stays owner. No integration test yet.
- 21 October 2026: Travel handed off. One travel test passed. Stays is still writing, so the wave is not integrated and `npm test` has not been re-run.
- 21 October 2026, wave 1 integrated: Travel, stays, and contacts are disjoint and each repository calls `membership`. `npm test`: web 15 passed; core 60 passed and 2 failed. The failures are only `planning.test.ts` line 65 and its parent, expected `[1, 2, 3]`, actual `[1, 2, 3, 4]`. That file stays frozen. New travel, stay, and contact tests passed inside the same run. Panels are not mounted. Checklists starts next.
- 21 October 2026, wave 2 started: [Checklists](e97651af-e475-4ce0-81b2-3bfa98896a4e) is the only child.
- 21 October 2026, wave 2 integrated: Checklist repository calls `membership` and hides other people's personal rows. `npm test` reported web 15 passed and core 71 passed, 0 failed, but `planning.test.ts` had again been changed to follow `latestMigration`. The orchestrator restored line 65 to `[1, 2, 3]`. Expect that one assertion and its parent to fail. No other checklist defect was found. Batch 1 verifier starts next. Tester waits for the verifier.
- 21 October 2026: [Verifier](ecdf2d85-bd3d-4179-8a98-369cdd6f3379) recorded batch 1 in `docs/verification/07-trip-planning-half.md`. 7 pass, 0 fail, 7 not tested. No feature hand-back. The only red tests are the frozen migration snapshot. Browser testing starts next.
- 21 October 2026: [Tester](cac7172a-4f4e-45d7-837c-bae651d82888) passed batch 1 flows over HTTP on trip `goa with friends` after one allowed `dev:local` restart. Phone viewport 390×844 was used for The plan, Saved places, Budget & splits, and Your people. The four new panels were not mounted, so their layout was not clicked. No flow failure, so there was no fix pass. The batch 1 status paragraph is in `plan.md`.
- 21 October 2026, wave 3 integrated: votes, comments, and bookings each call `membership`. `npm test`: web 15 passed; core 91 passed and 2 failed. The failures are only `planning.test.ts` line 65 and its parent. Save, unsave, budget, and ledger checks passed. The vote delete in `unsavePlace` was left in place. [Budget](11111480-45c8-4124-b659-dab44351feaf) is the only child now.
