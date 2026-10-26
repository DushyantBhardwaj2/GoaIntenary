# Browser and HTTP check: batch 1 trip planning

Date: 21 October 2026. The tester did not author the batch 1 feature code. No deploy, push, commit, cloud resource, `.env` edit, or feature-source edit. `planning.test.ts` was not edited. No code was patched. Batch 2 was not started.

Local preview used: web `http://127.0.0.1:3000`, core `http://127.0.0.1:4000`, discovery `http://127.0.0.1:4100`. Calls went through the web origin. The local preview was left running.

**Flows 1–4 passed over HTTP. The phone viewport was not checked for Travel, Stays, Contacts, or Checklist, because those panels are not mounted. The existing trip screens were checked at 390×844.**

## Server restart

The first travel write hit a core process that did not expose the new route. That is the allowed restart case. `npm run dev:local` was restarted once from the repo root. The restart rotates the local session secret, so every later call signed in again. The server was left running.

| | |
| --- | --- |
| Account | Aman, synthetic `POST /api/auth/local` `{"account":"aman"}`, `Origin: http://127.0.0.1:3000`. Response 200, `goa_access` set. |
| Trip | Reused **goa with friends**, `a3678922-b570-4166-ae4b-d0caf29c6490`. `GET /api/core/v1/trips/{tripId}` returned 200. Aman is the accepted organiser. |
| Sent | `POST /api/core/v1/trips/a3678922-b570-4166-ae4b-d0caf29c6490/travel` with `Idempotency-Key`, mode `flight`, title `BOM to GOI`, places Mumbai and Goa, times `2026-12-18T09:30:00+05:30` and `2026-12-18T11:05:00+05:30`, terminals `T2` and `T1`, notes `Window seats`, reference `PNR-B1-390`, and both participant ids. |
| Expected | 201 |
| Happened | 404 `{ "error": { "code": "NOT_FOUND", "message": "That resource is unavailable." } }` |
| Viewport | Not a browser action |

After the restart the same trip still existed. Guest One, created before the restart, was still a participant. The travel write was sent again and returned 201. Details are in Flow 1.

## Trip and people used

Signed in as Aman. `GET /api/core/v1/trips` returned four organiser trips. Reused the first, **goa with friends**.

`GET /api/core/v1/trips/{tripId}/expense-participants` first returned only Aman (`10000000-0000-4000-8000-000000000001`, kind `member`). Sent `POST` the same path with `{"displayName":"Guest One"}` and an `Idempotency-Key`. Response 201. Guest One id `2b730e19-b491-4365-b5a2-0a5459967f87`, `userId` null, kind `guest`. A later GET listed both.

Riya was not a member. `GET /api/core/v1/me` as Riya returned user id `10000000-0000-4000-8000-000000000002`. Invitation shape, read from the create response before accept: `id`, `expiresAt`, `revoked`, `requiresApproval`, `createdAt`, `token`. The token value is not recorded. Accept was `POST /api/core/v1/invitations/accept` with `{"token":"<that token>"}`.

## Flow 1 — travel

Owner: travel. Viewport: not checked. `TravelPanel` is not mounted in `workspace.tsx`.

After the restart, signed in again as Aman.

Sent `POST /api/core/v1/trips/a3678922-b570-4166-ae4b-d0caf29c6490/travel` with `Idempotency-Key` and:

```json
{
  "mode": "flight",
  "title": "BOM to GOI",
  "departurePlace": "Mumbai",
  "arrivalPlace": "Goa",
  "departureAt": "2026-12-18T09:30:00+05:30",
  "arrivalAt": "2026-12-18T11:05:00+05:30",
  "departureTerminal": "T2",
  "arrivalTerminal": "T1",
  "notes": "Window seats",
  "bookingReference": "PNR-B1-390",
  "travellerIds": [
    "10000000-0000-4000-8000-000000000001",
    "2b730e19-b491-4365-b5a2-0a5459967f87"
  ]
}
```

Expected 201, then a GET that still has this segment, both terminals, the notes, the reference, and both traveller ids.

Happened: **201**. Segment id `058a073e-c9a5-4fb9-a790-2d90c05a9a05`. Stored times are the same instants in UTC: departure `2026-12-18T04:00:00.000Z`, arrival `2026-12-18T05:35:00.000Z`. Terminals `T2` and `T1`, notes `Window seats`, reference `PNR-B1-390`, both traveller ids present.

Sent `GET /api/core/v1/trips/a3678922-b570-4166-ae4b-d0caf29c6490/travel`.

Expected the same segment.

Happened: **200**, one segment, the same id and the same fields, including both traveller ids.

**Pass.**

## Flow 2 — stays

Owner: stays. Viewport: not checked. `StaysPanel` and `stay-map.tsx` are not mounted. The Leaflet pin was **not tested** in the browser. No pin was claimed.

Sent `POST /api/core/v1/trips/a3678922-b570-4166-ae4b-d0caf29c6490/stays` with `Idempotency-Key`:

```json
{
  "propertyName": "Calangute House",
  "address": "Calangute Beach Road",
  "checkIn": "2026-12-18T14:00:00+05:30",
  "checkOut": "2026-12-20T11:00:00+05:30",
  "phone": "0832 123 4567",
  "contactName": "Front Desk",
  "notes": "Sea-facing room",
  "guestIds": ["10000000-0000-4000-8000-000000000001"],
  "latitude": 15.5,
  "longitude": 73.8
}
```

Expected 201.

Happened: **201**. Stay id `4efb9458-baa7-470e-980f-7fa67f99f202`. Latitude `15.5`, longitude `73.8`. Check-in stored as `2026-12-18T08:30:00.000Z`, check-out as `2026-12-20T05:30:00.000Z`. Guest id kept.

Sent a second `POST` to the same path with `Idempotency-Key`:

```json
{
  "propertyName": "Panaji Room",
  "address": "Fontainhas",
  "checkIn": "2026-12-20T15:00:00+05:30",
  "checkOut": "2026-12-22T10:00:00+05:30",
  "phone": "0832 765 4321",
  "contactName": "Host",
  "notes": "No map coordinates",
  "guestIds": ["10000000-0000-4000-8000-000000000001"],
  "latitude": null,
  "longitude": null
}
```

Expected 201.

Happened: **201**. Stay id `fb10ed7e-2482-4d8c-b2ab-3feef8040628`. Latitude null, longitude null.

Sent `GET /api/core/v1/trips/a3678922-b570-4166-ae4b-d0caf29c6490/stays`.

Expected both stays listed.

Happened: **200**, count 2. Both ids were present, with the coordinates above and the same guest id.

**Pass.** Pin: not tested.

## Flow 3 — contacts

Owner: contacts. Viewport: not checked. `ContactsPanel` is not mounted. A `tel:` link was **not clicked**.

`contacts-panel.tsx` builds the link in `callHref`: strip non-digits; if fewer than 7 digits, there is no link; otherwise `tel:` plus a leading `+` only when the typed phone contains `+`, then the digits. For `0832 111 0001` that would be `tel:08321110001`. The same construction applies to the other four numbers. The page-stay check for that link was **not exercised** in the browser.

Sent five `POST`s to `/api/core/v1/trips/a3678922-b570-4166-ae4b-d0caf29c6490/contacts`, each with an `Idempotency-Key`:

| Role | Name | Phone | Result |
| --- | --- | --- | --- |
| organiser | Trip organiser Aman | 0832 111 0001 | 201 `ae3f8793-3ee2-4198-a78c-8461ecaa05ef` |
| hotel | Calangute front desk | 0832 111 0002 | 201 `e1a201f2-6391-4e47-8adb-a2c1ce0600de` |
| driver | Airport driver | 0832 111 0003 | 201 `7249a141-b430-4e44-909f-2f87bd93eb4e` |
| rental | Scooter rental | 0832 111 0004 | 201 `9f732cdf-4afb-4eeb-9899-36b670fb35d7` |
| activity_provider | Spice farm guide | 0832 111 0005 | 201 `01da94e6-6896-423b-a39b-c88983a5512f` |

Expected each 201, then a GET containing all five.

Sent `GET /api/core/v1/trips/a3678922-b570-4166-ae4b-d0caf29c6490/contacts`.

Happened: **200**, count 5. All five ids, roles, names, and phones were still there.

**Pass.** `tel:` click: not tested.

## Flow 4 — checklist

Owner: checklist. Viewport: not checked. `ChecklistPanel` is not mounted.

Members before the invite: only Aman, accepted organiser. Riya was absent.

Sent, as Aman, `POST /api/core/v1/trips/a3678922-b570-4166-ae4b-d0caf29c6490/invitations` with `{"requiresApproval":false}`.

Expected 201 and an invitation object that includes a token.

Happened: **201**. Keys were `id`, `expiresAt`, `revoked`, `requiresApproval`, `createdAt`, `token`. `requiresApproval` was false. `revoked` was false. Token length 43. Token not recorded. Invitation id `35983caf-91c4-4bd0-a07a-544f0dac7550`. Expires `2026-10-28T16:13:44.478Z`.

Signed in as Riya (`POST /api/auth/local` `{"account":"riya"}`, 200). Sent `POST /api/core/v1/invitations/accept` with `{"token":"<invitation token>"}`.

Expected acceptance.

Happened: **200** `{"tripId":"a3678922-b570-4166-ae4b-d0caf29c6490","status":"accepted"}`.

Signed back in as Aman. Sent `POST /api/core/v1/trips/{tripId}/checklist` with `Idempotency-Key` and `{"visibility":"personal","title":"Aman passport","assigneeUserId":null}`.

Expected 201.

Happened: **201**. Item id `5cce5c70-acf5-4f75-b7e6-72d4d0b9b599`. `assigneeUserId` null, `completedAt` null.

Sent `POST` the same path with `{"visibility":"shared","title":"Pack the charger","assigneeUserId":"10000000-0000-4000-8000-000000000002"}`.

Expected 201.

Happened: **201**. Item id `44c89477-46b3-4384-ab5e-272515d85fee`. Assignee is Riya. `completedAt` null.

Signed in as Riya. Sent `PATCH /api/core/v1/trips/{tripId}/checklist/44c89477-46b3-4384-ab5e-272515d85fee` with `{"completedAt":"2026-10-21T21:40:00+05:30"}`.

Expected the shared item to be completed.

Happened: **200**. `completedAt` stored as `2026-10-21T16:10:00.000Z`, the same instant.

Still as Riya, sent `GET /api/core/v1/trips/{tripId}/checklist`.

Expected Aman's personal item absent, and the shared item present and completed.

Happened: **200**. The list had one item, `Pack the charger`, shared, assignee Riya, `completedAt` `2026-10-21T16:10:00.000Z`. `Aman passport` was absent.

Signed back in as Aman. Sent the same GET.

Expected his personal item present.

Happened: **200**. Both items were present: `Aman passport` (personal, unassigned, not completed) and `Pack the charger` (shared, assigned to Riya, completed at the same instant).

**Pass.**

## Existing screens at 390×844

Browser: cursor-ide-browser. Viewport set with device metrics override before any sign-in click, then measured as `window.innerWidth` 390 and `window.innerHeight` 844. Page `scrollWidth` was 390, so the page itself did not scroll sideways. The override was cleared after these checks.

Signed in by clicking the synthetic **Aman** button on `http://127.0.0.1:3000/auth` (“Aman”, “Start a trip”). Landed on `http://127.0.0.1:3000/trips`, signed in (avatar A, Sign out). Clicked the **goa with friends** card. Landed on `/trips/a3678922-b570-4166-ae4b-d0caf29c6490`.

The workspace tabs are only **The plan**, **Saved places**, **Budget & splits**, and **Your people**. Travel, Stays, Contacts, and Checklist were not in the tab row.

At 390px the tab row is a horizontal scroller (`overflow-x: auto`, scroll width 466, client width 350). On first paint, **Your people** started at x=390, so it was outside the visible 390px width until the tab row was scrolled. The day strip also clips: Day 01 and Day 02 were visible, and Day 03 began as a cut-off “D”. The day buttons were still in the page: Day 01 through Day 06, each “0 plans”, and Unscheduled “0 ideas”.

### The plan

Opened with the trip. Tab pressed. URL has no `tab` query.

Saw the trip title **goa with friends**, dates **31 Oct 2026 — 5 Nov 2026**, “2 joined · 8 planned”, styles Adventure, Beaches, Culture, Food, Nightlife, Relaxation, and the local-review note that Aman is a synthetic account. Saturday 31 Oct was selected, with “Add a plan”, the line about building the day by hand, and “This day on the map” with 0 pins. The map drew Goa (Panaji, Margao, and the coast), zoom controls, and the Leaflet and OpenStreetMap attribution. The accessibility tree also included the empty-day heading “A day with possibilities.”

The hero count says 8 planned while every day button and Unscheduled said 0. That is what the screen showed. It is the existing plan screen, not a travel, stay, contact, or checklist flow.

### Saved places

Clicked **Saved places**. URL became `?tab=saved`. Tab pressed.

Saw “Keep the good ideas.”, “Find a place”, the day selector defaulting to “Day 1 · Sat, 31 Oct”, and the empty state “Follow a little curiosity.” with “Explore Goa”. No saved-place cards.

### Budget & splits

Clicked **Budget & splits**. URL became `?tab=budget`. Tab pressed.

Saw “Trip expenses”, balance ₹0 (“You’re all settled on allocated bills”), group spending ₹0 and 0 expenses, “The first bill starts here.”, and “Add your first expense”. Group balances listed three people, each ₹0 settled: **Aman** (you, Member), **Guest One** (Guest), **Riya** (Member).

### Your people

The tab row was scrolled until **Your people** was visible (about x=275, width 96). Pointer clicks on that button focused it and left Budget & splits pressed; the URL stayed `?tab=budget`. A coordinate click aimed at the tab’s CSS centre was delivered to **Settle up** instead, which only focused that button. No settle dialog opened. The button’s own click handler was then invoked. The URL changed to `?tab=people` and the tab became pressed.

Saw “Your little circle” with count **2**, “You manage access”, **Aman (you)** as Trip organiser, and **Riya** as Trip member with Remove. Below that: “Good company starts with an invitation.”, “Create invite link”, the line “Organiser approval is always required.”, and “Invitation 1”, “Expires 28 Oct · approval required”, Active, Revoke.

The invitation created over HTTP had `requiresApproval: false`, and Riya’s accept returned `accepted`. The people screen still labelled that link “approval required”. That is the existing people screen, not a checklist flow failure.

## Result

| Flow | Owner | Result | Viewport |
| --- | --- | --- | --- |
| 1 Travel | travel | Pass, HTTP only, after one restart | Not checked. Panel not mounted. |
| 2 Stays | stays | Pass, HTTP only. Leaflet pin not tested. | Not checked. Panel not mounted. |
| 3 Contacts | contacts | Pass, HTTP only. `tel:` not clicked. | Not checked. Panel not mounted. |
| 4 Checklist | checklist | Pass, HTTP only | Not checked. Panel not mounted. |
| The plan, Saved places, Budget & splits, Your people | existing screens | Rendered | 390×844 |

No batch 1 flow failure to hand back. Local preview left running at `http://127.0.0.1:3000`.

# Batch 2

Date: 21 October 2026. The tester did not author the batch 2 feature code. No deploy, push, commit, cloud resource, `.env` edit, or feature-source edit. `planning.test.ts` was not edited. No code was patched. Batch 3 was not started. `docs/verification/07-trip-planning-half.md` was not edited.

**Flows 5–8 passed over HTTP. None were clicked at 390×844. The phone viewport was not checked.**

## Server

At the start of this pass, web `127.0.0.1:3000`, core `127.0.0.1:4000`, and discovery `127.0.0.1:4100` did not answer. That is the allowed restart case. `npm run dev:local` was started once from the repo root. The restart rotates the local session secret, so every later call signed in again. The server was left running.

After the restart, `POST /api/auth/local` with `{"account":"aman"}`, `Content-Type: application/json`, and `Origin: http://127.0.0.1:3000` returned 200 and set `goa_access`. `GET /api/core/v1/trips/a3678922-b570-4166-ae4b-d0caf29c6490` returned 200. The trip is still **goa with friends**. Aman is the accepted organiser. Riya (`10000000-0000-4000-8000-000000000002`) is still an accepted member. No new invitation was created. Trip budget was already `3000000` paise. Saved places were empty. Activities were empty. The batch 1 flight `058a073e-c9a5-4fb9-a790-2d90c05a9a05` and stay `4efb9458-baa7-470e-980f-7fa67f99f202` (Calangute House) were still there.

## Browser

Browser tools: cursor-ide-browser. They connected, listed tabs, navigated, and evaluated the page.

The auth document did not stay loaded. Repeated reads of `http://127.0.0.1:3000/auth` came back `readyState` `loading` with an empty body, while the dev server kept logging full `GET /auth` responses. One completed read, at `window.innerWidth` 1920 and `window.innerHeight` 1080, did include the synthetic **Aman** / **Start a trip** control in the page text. The following accessibility snapshot did not include that button, and the document was loading again before a click was sent. No Aman click was delivered. Riya was not signed in through the browser.

`Emulation.setDeviceMetricsOverride` was sent with width 390, height 844, `deviceScaleFactor` 1, and `mobile` true, before any trip click. On a completed document, `screen.width` was 390 and `screen.height` was 844, but `window.innerWidth` was 980, `window.innerHeight` was 2119, and `documentElement.scrollWidth` was 980. That is not a 390-pixel layout. The trip was never clicked. The plan, Saved places, Budget & splits, and Your people were not opened. Whether Your people still needs a sideways scroll was not seen.

## Flow 5 — votes

Owner: votes. The Interested control was **not clicked**. The phone control was not clicked. There was no saved place, and the browser could not hold the auth page, so the place was saved over HTTP.

Signed in as Aman on one cookie jar, and as Riya on a second HTTP cookie jar. That second jar does not replace Aman’s cookie. A browser profile for Riya was not used.

Sent `POST /api/core/v1/trips/a3678922-b570-4166-ae4b-d0caf29c6490/saved-places` with `Idempotency-Key` and Calangute Beach (`calangute-beach`, north, beach, the catalogue coordinates and source URL).

Expected the place to be stored.

Happened: **200**. A later GET listed only `calangute-beach`.

Sent, as Aman, `PUT /api/core/v1/trips/{tripId}/saved-places/calangute-beach/votes` with `{"interested":true}`.

Expected count 1 and the name Aman.

Happened: **200**. `count` 1. Voters: Aman.

Sent, as Riya, the same PUT with `{"interested":true}`.

Expected count 2 and both display names.

Happened: **200**. `count` 2. Voters: Aman, Riya. A following GET as Aman returned the same count and the same two names.

Sent, as Aman, `PUT` with `{"interested":false}`.

Expected the count to drop by one and only Riya to remain.

Happened: **200**. `count` 1. Voters: Riya.

Sent, as Aman, `DELETE /api/core/v1/trips/{tripId}/saved-places/calangute-beach`.

Expected the votes to go with the place.

Happened: **204**. `GET` the votes URL returned **404** `NOT_FOUND` `That resource is unavailable.` `PUT` `{"interested":true}` on that same id returned **404** with the same code and message.

**Pass, HTTP only.**

## Flow 6 — comments

Owner: comments. The thread is not on the activity card. The timestamp was **not seen in the page**. The India time label was not seen.

Sent, as Aman, `POST /api/core/v1/trips/{tripId}/activities` with `Idempotency-Key` and `{"title":"Comment check"}`.

Expected 201.

Happened: **201**. Activity id `e440d9d6-03f3-4498-8f20-7d6b051446bf`. `estimatedCostPaise` 0. `version` 1.

Sent `POST /api/core/v1/trips/{tripId}/activities/e440d9d6-03f3-4498-8f20-7d6b051446bf/comments` with `{"body":"Meet at the lobby"}`.

Expected 201 and `createdAt`.

Happened: **201**. Comment id `dd1d2288-3723-4b6d-98ec-e117c5a826a3`. `createdAt` `2026-10-21T18:14:53.032Z`. Body `Meet at the lobby`.

Sent `PATCH` that comment with `{"body":"Meet at the lobby at noon"}`.

Expected the new body.

Happened: **200**. Body `Meet at the lobby at noon`. `createdAt` unchanged. `updatedAt` `2026-10-21T18:14:53.278Z`.

Sent `DELETE` that comment.

Expected it to leave the list.

Happened: **204**. `GET` the comment list returned **200** with `comments` length 0.

**Pass, HTTP only.**

## Flow 7 — bookings

Owner: bookings. `BookingsPanel` and `BookingLinkPicker` are not mounted. The phone file-picker check was **not exercised** because the panel is not mounted. No booking screen was opened.

Sent `POST /api/core/v1/trips/{tripId}/bookings` with `targetType` `activity`, the Comment check activity id, `providerName` `Coast Desk`, `reference` `FILE-B2`, and `file` `ticket.pdf`.

Expected rejection.

Happened: **400** `VALIDATION_ERROR` `Check the supplied information.`

Sent three creates, each with `Idempotency-Key` and no `file`:

| targetType | targetId | providerName | reference | Result |
| --- | --- | --- | --- | --- |
| activity | `e440d9d6-03f3-4498-8f20-7d6b051446bf` | Coast Desk | ACT-B2-390 | 201 `59be2dbc-4279-4581-81ac-98259dbb2c47` |
| stay | `4efb9458-baa7-470e-980f-7fa67f99f202` | Calangute House | STAY-B2-390 | 201 `88133b8e-8c56-4479-83a0-d3dc1773a82e` |
| travel | `058a073e-c9a5-4fb9-a790-2d90c05a9a05` | IndiGo | FLT-B2-390 | 201 `43776fc9-5d0f-4dbd-bd4b-e6aa8edfdb4a` |

Expected each 201, then a GET whose three references are present and whose objects have no `file` field.

Sent `GET /api/core/v1/trips/{tripId}/bookings`.

Happened: **200**, count 3. References `ACT-B2-390`, `STAY-B2-390`, and `FLT-B2-390` were present. None of the three objects had a `file` field. Keys were `id`, `tripId`, `targetType`, `targetId`, `providerName`, `reference`, `notes`, `createdBy`, `createdAt`, `updatedAt`.

**Pass, HTTP only.**

## Flow 8 — budget

Owner: budget. Budget & splits was **not opened**. **Set category limits** was not clicked. The words Forecast remaining were **not seen** beside the remaining figure. The same amounts were read and written over HTTP. There was no second server restart: the button was never on screen, so the stale-server retry did not apply.

`GET /api/core/v1/trips/{tripId}/budget` as Aman, before the writes:

| Field | Paise |
| --- | --- |
| budgetPaise | 3000000 |
| plannedTotalPaise | 0 |
| actualTotalPaise | 0 |
| remainingPaise | 3000000 |
| forecastRemainingPaise | 3000000 |
| accommodation limitPaise | null |

Sent `PUT /api/core/v1/trips/{tripId}/budget/category-limits` with `{"limits":[{"category":"accommodation","limitPaise":800000}]}`.

Expected the accommodation cap to be stored.

Happened: **200**. The following GET still had remaining `3000000` and forecast remaining `3000000`, and accommodation `limitPaise` `800000`.

Sent `POST /api/core/v1/trips/{tripId}/expenses` with `Idempotency-Key`, title `Chai`, `amountPaise` 10000, category `food`, date `2026-10-31`, payer `10000000-0000-4000-8000-000000000001`, and an equal split of that same participant.

Expected paid spending to change actual remaining, and forecast remaining to stay put.

Happened: **201**. Expense id `94d3ed06-914f-4331-bd08-66a3927bc0d4`. The following GET had `actualTotalPaise` 10000, `remainingPaise` 2990000, `plannedTotalPaise` 0, and `forecastRemainingPaise` 3000000. The accommodation cap was still 800000.

Sent `PATCH /api/core/v1/trips/{tripId}/activities/e440d9d6-03f3-4498-8f20-7d6b051446bf` with `{"version":1,"estimatedCostPaise":50000}`.

Expected forecast remaining to move, and actual remaining to stay put.

Happened: **200**. Stored estimate 50000, version 2. The following GET had `plannedTotalPaise` 50000, `forecastRemainingPaise` 2950000, `actualTotalPaise` 10000, and `remainingPaise` 2990000.

**Pass, HTTP only.** The on-screen remaining figures were not compared.

## Existing screens

The plan, Saved places, Budget & splits, and Your people were not opened in this pass. Nothing was recorded about a sideways scroll on Your people.

## Result

| Flow | Owner | Result | Viewport |
| --- | --- | --- | --- |
| 5 Votes | votes | Pass, HTTP only. Interested was not clicked. | Not checked. |
| 6 Comments | comments | Pass, HTTP only. Timestamp was not seen in the page. | Not checked. Panel not mounted. |
| 7 Bookings | bookings | Pass, HTTP only. File picker was not exercised. | Not checked. Panels not mounted. |
| 8 Budget | budget | Pass, HTTP only. Set category limits was not clicked. Forecast remaining was not seen on screen. | Not checked. |
| The plan, Saved places, Budget & splits, Your people | existing screens | Not opened this pass | Not checked. |

No batch 2 product failure to hand back from the HTTP contracts above. The 390×844 click path was not completed. Local preview left running at `http://127.0.0.1:3000`.
