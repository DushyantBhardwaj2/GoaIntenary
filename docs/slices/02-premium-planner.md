# Goa Together — premium planner implementation contract

21 October 2026. Latest owner request expands the local product to a public editorial landing page, discoverable Goa places, persistent trip management, manual itineraries and an INR budget planner, with optional Three.js Tubes and sticky story cards. Existing Cognito integration, invitation routes, PostgreSQL data and privacy boundaries remain. No cloud provisioning or account upgrade is authorised by this visual/product change; existing Stage 0 gates stand.

## Delivery and ownership

1. Core creator owns `services/core-api/**`: additive migration 002, compatible trip fields, editing/soft deletion, activity ordering, saved places, paid expense records and authoritative budget totals. Money skill applies; this slice records one payer and total spend, **no shared-debt/split/settlement claims**.
2. Website creator owns `apps/web/**` except `src/components/visual/**` and `src/app/api/discovery/**`: split the existing oversized app into reusable shell/auth/trips/planner/discovery/budget components, preserve auth/join flows, implement `/`, `/trips`, `/explore`, `/auth`, `/trips/:id` and `/join`.
3. Discovery creator owns `services/discovery/**` and `apps/web/src/app/api/discovery/**`: real Python FastAPI public source-backed catalogue/search, at least twelve reviewed entries if sources permit, no private writes. It owns public catalogue data. Read-only seed JSON is a deliberate reviewed catalogue, not live inventory; expose source/check date and coverage clearly.
4. Coordinator owns `apps/web/src/components/visual/**`, root scripts/package/lock/docs and integration. Export `TubesBackground` and `StackingStory` from these paths for website integration. No other agent edits those paths. Coordinator checks reference library/API/licence and chooses a supported cleanup-safe Three.js implementation.
5. Rotate a specialist to independent verification after creators hand off runnable work. Browser policy previously blocked rendered inspection: do not bypass it or claim phone/animation checks passed from source or HTTP tests.

## Shared records and validation

Keep existing fields and response envelopes. Additional fields are backward compatible. New schema migrations must apply to the already-populated local database without deleting it.

`Trip` adds `region:'north'|'south'|'central'|'all'`, `travellerCount:number` (planned people, not confirmed accounts, 1..50), `budgetPaise:number|null` (0..1_000_000_000), `styles:string[]` from `beaches,nightlife,food,culture,adventure,relaxation`, `acceptedMemberCount:number`, `activityCount:number`. Creation inputs make all additions optional: defaults all/1/null/[] preserve existing callers. `PATCH /v1/trips/:id` accepts editable fields; organiser only. Reject edits that would place saved activities outside new dates (409); never silently move/delete them. Trip dates at most 366 days apart for new/edited trips. `DELETE /v1/trips/:id` soft-deletes with safe audit, hides all trip resources and invitations, repeat-safe; organiser only. Existing IDs/routes and saved data remain intact.

`Activity={id,tripId,title,description,location,category,day:string|null,startTime:string|null,endTime:string|null,estimatedCostPaise:number,notes,meetingPoint,placeId:string|null,latitude:number|null,longitude:number|null,sortOrder:number,version:number,createdBy:string}`. Category: `beach,food,cafe,nightlife,culture,adventure,shopping,transport,other`. Date is a real YYYY-MM-DD within trip; null means unscheduled. Time is HH:mm, both optional, end requires start and must follow it. No automatic itinerary. Show overlap warnings only; manual reorder persists separately from time labels. Paise safe integer 0..1_000_000_000; string fields bounded. Optimistic `version` on activity edits prevents overwriting another member's change.

`SavedPlace={placeId,title,category,region,latitude,longitude,sourceUrl,savedBy,createdAt}`. Save accepts a bounded public `Place` snapshot `{placeId,title,category,region,latitude,longitude,sourceUrl}`. Treat it as untrusted user input, permit only HTTP(S) source URLs with a hostname and no embedded username/password, never fetch arbitrary URLs server-side. Unique per trip/place. Save does not schedule or imply a booking. Trip-specific notes/time survive catalogue edits.

`Expense={id,tripId,title,amountPaise,category,date,paidByUserId,paidByDisplayName,createdBy,createdAt,version}`. Categories: `accommodation,transport,food,activities,shopping,other`. Positive integer paise, accepted member payer, creator or organiser edits/deletes, audit retained. **No beneficiaries/splits/debt ledger in this slice**; label recorded spending and approximate planned cost per traveller, never what someone owes. One payer is recorded for provenance. No email/reminder delivery claims.

## Core HTTP additions

Existing Bearer/cookie BFF, no-store, errors, hashed invites and approval defaults stay. Non-member and removed-member reads/writes return indistinguishable 404. Members may edit the shared itinerary/save places/add spending; only organiser edits trip settings or deletes trip. Actor/role is never accepted from a body.

- `PATCH /v1/trips/:tripId` body editable partial Trip input → `{trip}`.
- `DELETE /v1/trips/:tripId` → 204.
- `GET /v1/trips/:tripId/activities` → `{activities:Activity[]}` ordered day/sortOrder, unscheduled separate in UI.
- `POST /v1/trips/:tripId/activities` body activity editable fields (title required; defaults rest) → 201 `{activity}`. Honor optional UUID Idempotency-Key.
- `PATCH /v1/trips/:tripId/activities/:activityId` body editable partial fields + required `version` → `{activity}` (409 stale).
- `DELETE /v1/trips/:tripId/activities/:activityId` → 204 repeat-safe.
- `POST /v1/trips/:tripId/activities/reorder` body `{day:string|null,activityIds:string[]}` → `{activities}`. Exact current set of IDs for that day, no duplicates/foreign trip, atomic; mismatch 409. Does not move days.
- `GET /v1/trips/:tripId/saved-places` → `{places:SavedPlace[]}`.
- `POST /v1/trips/:tripId/saved-places` snapshot body above → `{place:SavedPlace}` idempotent unique.
- `DELETE /v1/trips/:tripId/saved-places/:placeId` → 204.
- `GET /v1/trips/:tripId/budget` → `{budgetPaise,plannedTotalPaise,actualTotalPaise,remainingPaise,estimatedPerPersonPaise,actualPerPersonPaise,categoryTotals:[{category,plannedPaise,actualPaise}],expenses:Expense[]}`. Remaining = budget minus actual, null without budget. Approx per-person uses declared planned travellers, rounded to paise; never a settlement. Planned total = all activity estimates, not added to paid spend. Categories map beach/culture/adventure/nightlife→activities, cafe/food→food; others intuitive.
- `POST /v1/trips/:tripId/expenses` body `{title,amountPaise,category,date,paidByUserId?}` → 201 `{expense}`. Optional UUID Idempotency-Key; payer defaults actor.
- `PATCH /v1/trips/:tripId/expenses/:expenseId` editable partial + required version → `{expense}`.
- `DELETE /v1/trips/:tripId/expenses/:expenseId` → 204.

## Public discovery HTTP

Python binds 127.0.0.1:4100 in development. `GET /health` → `{status:'ok',catalogueCount:number}`. `GET /v1/places?q=&category=&region=` → `{places:Place[],total:number,catalogue:{kind:'curated',checkedAt:string,notice:string}}`. `GET /v1/places/:id` → `{place}`. `Place={id,title,description,category,region,area,latitude,longitude,sourceUrl,checkedAt}`. Use the same activity categories and region enums (records north/south/central; all is a filter). No fabricated hours/prices/ratings. Web BFF `/api/discovery/places` and `/api/discovery/places/:id` forwards to DISCOVERY_API_URL, validates bounded known filters, returns retryable 503 if unavailable. No silent fake fallback. Public landing can show explicitly illustrative trip inspiration; sample itinerary never becomes a saved plan without user action.

## Visual integration

Exact brand tokens: green #173F35, forest #245B49, ivory #F7F4EB, paper #FFFEFA, coral #DE6C4E, sea-glass #91AAA0, gold #E8D9B4, muted #687C75. Retain wordmark/sun/editorial type and original illustrations. No external unlicensed destination photos or brittle remote image URLs.

`TubesBackground({children?,className?,palette?,interactive?:boolean})` is a client component, lazy module import; isolated decorative canvas behind hero, static fallback, pointer-events:none. Interaction observes region pointer movement without intercepting foreground controls; branded click palette cycling optional. Init only visible, reduced motion/static coarse pointer fallback, DPR <=1.5, stop offscreen/hidden, ResizeObserver, context-loss fallback, cleanup RAF/events/observers/geometries/materials/renderer and context. No canvas behind forms/planner. `StackingStory()` exports meaningful sticky story cards, CSS foundation, mobile normal flow/reduced motion, optional transform progress only.

## Acceptance

Persist create/edit/reopen/delete without clearing existing trips; construct days from dates, add/edit/move/reorder/delete activities and keep estimates/notes after API restart. Save a sourced place and explicitly add it to a chosen day. Budget example: budget ₹20,000, planned ₹8,000 and actual ₹1,250 => remaining ₹18,750 (not ₹10,750); round inputs exactly and reject malformed money. Three accounts verify member/outsider/removed boundaries for every new resource family. Migration repeat-safe; old tests pass. Render controls genuinely save and expose errors/retry. Build/typecheck/test real services; source review effect teardown/reduced-motion; explicitly label browser policy limits if still blocked. No new cloud charges.
