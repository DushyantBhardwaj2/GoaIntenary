# Independent verification: trip-planning half

Date: 21 October 2026. The verifier did not author the batch 1 feature code. Scope is batch 1 only. Local synthetic accounts and file-backed embedded PostgreSQL. No deploy, push, commit, cloud resource, `.env` edit, or server restart.

**The trip-planning half is not done.** This file records batch 1 only. It does not close the half.

## Batch 1 — Travel, stays, contacts, checklists

**7 pass, 0 fail, 7 not tested.**

No batch 1 feature failure to hand back. The only red tests are the frozen migration snapshot recorded below.

### npm test

Command: `npm test` from the repo root. `npm run test:discovery` was not run. No browser was started.

| Workspace | Result |
| --- | --- |
| `@goa/web` | 15 passed, 0 failed. Exit would have been 0 for this workspace. |
| `@goa/core-api` | 71 tests: 69 passed, 2 failed. Duration about 128 seconds. |
| Root | Exit code 1. There is no `packages` workspace. Web ran, then core failed, and npm stopped. |

Core failures, both from the same assertion:

- `services/core-api/test/planning.test.ts` line 65, subtest `v1 trip, membership and invitation survive repeatable migration with safe defaults`.
- Parent suite `premium planner persists private itinerary and spending with additive migration`.

Expected migration versions `[1, 2, 3]`. Observed `[1, 2, 3, 4]`. Every other subtest in `planning.test.ts` passed in this run, including trip creation, activities, budget, outsider access, restart, removal, and soft deletion. Travel, stays, contacts, and checklist tests passed in the same run. Web tests passed.

### Acceptance

Pass means the stated code was read or the named test passed in this `npm test`. Browser rendering was not exercised.

| Item | Status | Evidence |
| --- | --- | --- |
| Travel rows include mode, both times, terminals, traveller participant ids, notes, and a booking reference. Outsider, pending, and removed are 404. | Pass | `travel.test.ts` passed. The saved flight asserts `mode` `flight`, `departureAt` `2026-12-04T05:00:00.000Z`, `arrivalAt` `2026-12-04T06:35:00.000Z`, both terminals, `bookingReference` `PNR-GOA-19`, and two participant ids. The same test then asserts `notes` `Coach 4` on update. Pending read/write, Dev outsider read/write, and removed-member read/write return 404 `That resource is unavailable.` `travel-repository.ts` maps those fields. `travel-panel.tsx` sends and shows them. Owner: travel. |
| Stays have check-in, check-out, guests, phone, and optional coordinates drawn only in `stay-map.tsx`. A stay with no coordinates still has a list path. Tile URL is `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with the OpenStreetMap copyright attribution. No prefetch and no offline tiles. `goa-map.tsx` was not edited for stays. | Pass | All six `stays.test.ts` subtests passed, including two guest ids, phone, check-in/out, a stay whose latitude is null and still listed, outsider, pending, and removed 404. `stays-panel.tsx` renders every stay in the list and labels a stay without both coordinates `No map pin`. Leaflet tiles and pins are only in `stay-map.tsx`, with that tile URL, the OpenStreetMap copyright link, and no prefetch or offline pack. `goa-map.tsx` has no stay references. This repo has no commits, so there is no parent diff; the file read is the place map. The stay map was not opened in a browser. Owner: stays. |
| Contacts cover organiser, hotel, driver, rental, and `activity_provider`. `contacts-panel.tsx` contains `tel:`. The organiser card does not change `goa_core_memberships.role`. | Pass | `contacts.test.ts` passed, including one card of each role and the membership-role comparison before and after. The organiser contact remains a card while `goa_core_memberships.role` stays `organiser` and `member`. `contact-repository.ts` does not update that role. `contacts-panel.tsx` builds `tel:` links. The panel was not opened in a browser. Owner: contacts. |
| Personal checklist rows are absent from another member's GET, including the organiser. Shared rows have assignee and completion. | Pass | `checklist.test.ts` passed. Riya's GET omits Aman's personal row. The organiser GET omits Riya's personal row, and organiser patch/delete of that row are 404. The shared cab stores Riya's assignee id and `completedAt`. Owner: checklists. |
| Every trip read and write in the four repositories calls `membership(`. Pending and removed paths are tested in that feature's test file. | Pass | Read in `travel-repository.ts` (`list`, `create`, `update`, `remove`), `stay-repository.ts` (`list`, `create`, `update`, `remove`), `contact-repository.ts` (`listContacts`, `createContact`, `updateContact`, `deleteContact`), and `checklist-repository.ts` (`listItems`, `createItem`, `updateItem`, `deleteItem`). Pending and removed 404s passed inside `travel.test.ts`, `stays.test.ts`, `contacts.test.ts`, and `checklist.test.ts`. |
| Batch 1 code does not add PDF export, S3 or upload routes, an archive/restore trip flow, account-deletion UI, a discovery admin writer, a `places.json` count other than 16, event records, weather, reminder jobs, or a new change-history screen. | Pass | Those strings are absent from the travel, stay, contact, and checklist route, repository, test, panel, and style files. Migration `004_trip_planning.sql` keeps the existing audit name `guest.archived` and the existing trip soft-delete action while adding the new planning actions. That is not a new archive/restore trip flow. `services/discovery/app/data/places.json` has 16 `"id"` matches. Discovery behavior was not run. |
| The four new panels are not mounted in `workspace.tsx`. | Pass | Expected until the dashboard wave. `workspace.tsx` still mounts The plan, Saved places, Budget & splits, and Your people. It does not import `TravelPanel`, `StaysPanel`, `ContactsPanel`, or `ChecklistPanel`. |

| Item | Status | Evidence |
| --- | --- | --- |
| Browser use of the four panels, phone viewport, keyboard, and refresh | Not tested | No browser was started. Panels are not mounted. |
| Votes | Not tested | `vote-routes.ts` is an empty `registerVoteRoutes` stub. No vote repository. |
| Comments | Not tested | `comment-routes.ts` is an empty `registerCommentRoutes` stub. |
| Bookings | Not tested | `booking-routes.ts` is an empty `registerBookingRoutes` stub. |
| Budget limits | Not tested | `budget-limit-routes.ts` is an empty `registerBudgetLimitRoutes` stub. |
| Activity status and attendees | Not tested | `activity-extra-routes.ts` is an empty `registerActivityExtraRoutes` stub. |
| Today dashboard | Not tested | `overview-routes.ts` is an empty `registerOverviewRoutes` stub. No Today tab and no `trip-overview.tsx`. |

### Frozen test snapshot

Severity: test snapshot only. Not a travel, stay, contact, or checklist defect. No batch 1 owner.

- File: `services/core-api/test/planning.test.ts` line 65.
- Steps: `npm test` from the repo root. The core workspace applies migration 004 and then runs this file.
- Expected: `SELECT version FROM goa_core_migrations` returns `[1, 2, 3]`.
- Observed: `[1, 2, 3, 4]`. The subtest fails, and the parent suite fails with it.
- `database.ts` sets `latestMigration = 4` and includes `004_trip_planning.sql`. The assertion was left frozen. It was not edited in this verification.

### Hand-back

None. No other existing test failed, so no batch 1 owner is named for a regression.

The trip-planning half stays open. Votes, comments, bookings, budget limits, activity status and attendees, and the Today dashboard are still empty stubs.

## Batch 2 — Votes, comments, bookings, budget limits

Date: 21 October 2026. The verifier did not author this batch. Scope is batch 2 only. No deploy, push, commit, cloud resource, `.env` edit, server restart, or feature-code edit. `services/discovery` was not edited. No browser was started.

**7 pass, 0 fail, 3 not tested.**

No batch 2 feature failure to hand back. The only red tests are the same frozen migration snapshot already recorded above.

**The trip-planning half is not done.** Activity status, attendees, and the Today dashboard are still empty stubs.

### npm test

Command: `npm test` from the repo root. `npm run test:discovery` was not run.

| Workspace | Result |
| --- | --- |
| `@goa/web` | 15 passed, 0 failed. Duration about 0.4 seconds. |
| `@goa/core-api` | 100 tests: 98 passed, 2 failed. Duration about 182 seconds. |
| Root | Exit code 1. There is no `packages` workspace. Web ran, then core failed, and npm stopped. |

Core failures, both from the same assertion already recorded in batch 1:

- `services/core-api/test/planning.test.ts` line 65, subtest `v1 trip, membership and invitation survive repeatable migration with safe defaults`.
- Parent suite `premium planner persists private itinerary and spending with additive migration`.

Expected migration versions `[1, 2, 3]`. Observed `[1, 2, 3, 4]`. Every other subtest in `planning.test.ts` passed in this run, including the paid-budget checks that still expect remaining `1_875_000`. All of `ledger.test.ts` passed (`selected travellers, guests and repayments persist with zero-sum authorised ledger` and its subtests). Votes, comments, bookings, and budget-limit tests passed. Travel, stays, contacts, and checklist tests also passed, so batch 1 was not re-opened.

### Acceptance

Pass means the stated code was read or the named test passed in this `npm test`. Browser rendering was not exercised.

| Item | Status | Evidence |
| --- | --- | --- |
| Votes are one interested row per member on a saved place, with names and count. Unsave deletes votes in the same transaction. The comment `// votes: delete place votes with the save` is still on that call. Pending, outsider, and removed are 404. | Pass | `votes.test.ts` passed, including one row when Aman votes again, a summary that names Aman and Riya with count 2, and an unsave that leaves zero `goa_core_place_votes` rows. Pending put/get, Dev put/get, and removed put/get return 404 `That resource is unavailable.` `vote-repository.ts` inserts with `ON CONFLICT (trip_id, place_id, user_id) DO NOTHING` and returns `count` plus voter `displayName`. `unsavePlace` in `planning-repository.ts` calls `removeVotesForPlace` on the same transaction client, with that comment, before deleting the saved place. `saved-places.tsx` shows the count and the names. Owner: votes. |
| Comments have timestamps, author edit/delete, and organiser delete. A member cannot edit someone else's comment. Dev and a removed member are 404. Deleted comments leave GET. | Pass | `comments.test.ts` passed. Create and edit return `createdAt` and `updatedAt` matching an ISO timestamp. Riya can patch and delete her own comment. Riya's patch of Aman's comment is 403 `FORBIDDEN`, and the body stays `Bring water`. The organiser delete of Riya's comment is 204, the row keeps `deleted_at`, and the next GET omits it. Dev and the removed member get 404 on get, post, patch, and delete, and the comment count does not change. `comment-repository.ts` maps both timestamps, allows update only for the author, and allows delete for the author or `organiser`. `activity-comments.tsx` shows the time and offers edit only to the author and delete to the author or organiser. Owner: comments. |
| Bookings link an activity, a stay, or travel with a reference, and have no file column or multipart route. A second live booking for the same target conflicts. A foreign activity id is rejected. | Pass | `bookings.test.ts` passed. The three creates store trimmed references `PAL-14`, `STAY-2`, and `6E221` on activity, stay, and travel. A second live booking for each target is 409 `CONFLICT` and inserts nothing. A foreign activity id is 400 `VALIDATION_ERROR` and inserts nothing. The bookings table has `reference` and no `file` column, and a `file` property on create or patch is 400. `booking-routes.ts` is JSON get/post/patch/delete with no multipart parser. `booking-repository.ts` checks the target on this trip and rejects a second live row for the same target. `bookings-panel.tsx` and `booking-link-picker.tsx` send `targetType`, `targetId`, and `reference` and have no file input. Owner: bookings. |
| Budget shows `forecastRemainingPaise` beside `remainingPaise`, and category `limitPaise`. `remainingPaise` is still budget minus paid spending. `forecastRemainingPaise` is budget minus `plannedTotalPaise`, or null when no budget is set. A member PUT to `/budget/category-limits` is 403. A removed member is 404. The fixture `2_000_000`, planned `800_000`, paid `125_000` returns remaining `1_875_000` and forecast remaining `1_200_000`. Ledger tests are unchanged in result. A limit does not reject an expense. | Pass | `budget-limits.test.ts` passed, including that fixture object and a food expense of `125_000` created with 201 while the food cap is `1_000`. A member PUT is 403 `FORBIDDEN` and the stored cap stays `750_000`. A removed member's PUT and GET are 404 `NOT_FOUND`. `budget()` in `planning-repository.ts` sets `remainingPaise` to budget minus the expense total, `forecastRemainingPaise` to budget minus `plannedTotalPaise`, and both to null when `budgetPaise` is null. Category rows include `limitPaise`. `budget-overview.tsx` shows Remaining and Forecast remaining side by side, and a category limit when one is set. The limit dialog in `budget.tsx` says a cap does not change bills, shares, or balances. `ledger-repository.ts` does not read category limits. `ledger.test.ts` passed in full. The other `planning.test.ts` budget subtests still passed with remaining `1_875_000`. Owner: budget. |
| Every trip read and write in `vote-repository.ts`, `comment-repository.ts`, `booking-repository.ts`, and `budget-limit-repository.ts` calls `membership(`. Pending and removed paths are tested in that feature's test file. The budget read is `budget()` in `planning-repository.ts`. | Pass | Votes: `getVotes` and `setVote`. Comments: `listComments`, `createComment`, `updateComment`, and `deleteComment`. Bookings: `listBookings`, `createBooking`, `updateBooking`, and `deleteBooking`. Budget write: `setCategoryLimits` calls `membership(client, actor, tripId, true)` before any category-limit insert. Budget read: `budget()` calls `membership` before totals or limits. Pending and removed 404s passed inside `votes.test.ts`, `comments.test.ts`, `bookings.test.ts`, and `budget-limits.test.ts`. A successful category-limit write or budget read does not skip membership. Owner: votes, comments, bookings, and budget for their own repositories. |
| Batch 2 code does not add PDF export, S3 or upload routes, an archive/restore trip flow, account-deletion UI, a discovery admin writer, a `places.json` count other than 16, event records, weather, reminder jobs, or a new change-history screen. | Pass | Those features are absent from the vote, comment, booking, and budget-limit route, repository, and test files, and from `saved-places.tsx`, `activity-comments.tsx`, `bookings-panel.tsx`, `booking-link-picker.tsx`, `budget-overview.tsx`, and the limit dialog in `budget.tsx`. The words that do appear are copy: a comment placeholder says "or a reminder", and the limit dialog says a cap is a reminder only. That is not a reminder job. Existing trip soft-delete in `workspace.tsx` and existing expense history in the ledger remain. `services/discovery/app/data/places.json` has 16 place ids. Discovery behavior was not run. |
| `ActivityComments`, `BookingsPanel`, and `BookingLinkPicker` are not mounted in `workspace.tsx`. | Pass | Expected until the dashboard wave. `workspace.tsx` still mounts The plan, Saved places, Budget & splits, and Your people. Saved places includes the vote control. Budget & splits includes `BudgetOverview` and the category-limit dialog. Nothing else imports `ActivityComments`, `BookingsPanel`, or `BookingLinkPicker`. |

Recorded finding, not a failed item. Owner: budget. File: `services/core-api/src/budget-limit-routes.ts`.

The category-limit PUT awaits `limit(request)` before `setCategoryLimits`. `rateLimit` inserts or increments `goa_core_rate_limits` and throws 429 when the hits pass 100. A caller over that limit gets 429 before membership, so before 403 or 404. The category-limit insert runs only after `membership(client, actor, tripId, true)` inside the write transaction, so that row is not written on the 429 path. The only write before membership is the rate-limit counter.

| Item | Status | Evidence |
| --- | --- | --- |
| Browser use of Saved places votes, `ActivityComments`, `BookingsPanel`, and `BookingLinkPicker` | Not tested | No browser was started. Phone viewport, keyboard, and refresh were not exercised. |
| Activity status and attendees | Not tested | `activity-extra-routes.ts` is still an empty `registerActivityExtraRoutes` stub. Not a failure. |
| Today dashboard | Not tested | `overview-routes.ts` is still an empty `registerOverviewRoutes` stub. No Today tab and no `trip-overview.tsx`. Not a failure. |

### Frozen test snapshot

Same snapshot as batch 1. Not a votes, comments, bookings, or budget defect. No batch 2 owner.

- File: `services/core-api/test/planning.test.ts` line 65.
- Steps: `npm test` from the repo root. The core workspace applies migration 004 and then runs this file.
- Expected: `SELECT version FROM goa_core_migrations` returns `[1, 2, 3]`.
- Observed: `[1, 2, 3, 4]`. The subtest fails, and the parent suite fails with it.
- `database.ts` sets `latestMigration = 4` and includes `004_trip_planning.sql`. The assertion was left frozen. `planning.test.ts`, `core.test.ts`, and `ledger.test.ts` were not edited.

### Hand-back

None. No batch 2 owner is named for a feature failure. The rate-limit ordering above is a recorded finding on budget, not a failed item.

The trip-planning half stays open. Activity status, attendees, and the Today dashboard are still empty stubs.
