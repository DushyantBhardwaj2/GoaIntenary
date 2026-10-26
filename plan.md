# Goa trip companion — product and delivery plan

**Status:** local Goa Together implementation completed on 21 October 2026. Slice 01 provides private trips/invited membership; Slice 02 adds the coastal public landing, optional original Three.js Tubes/sticky story, persistent trip management, manual itinerary, sixteen sourced discovery places and exact INR budget/spending. Web/core/Python tests, production build and both eight-group HTTP suites pass. See [Slice 02 handoff](docs/slices/02-handoff.md) and [independent verification](docs/verification/02-premium-planner.md). AWS development backends and PostgreSQL are live. The website is now deployed to Vercel, with the public landing, discovery catalogue and sign-in gate checked in a browser. Private cloud account journeys, mobile/GPU/keyboard acceptance, restore and full production acceptance remain open. See the deployment update below.
**Planning baseline:** 21 October 2026. Recheck prices, regional availability, and provider terms before provisioning.

**Infrastructure connection update (21 October 2026):** AWS development deployment is live in Mumbai. Both CloudFormation stacks completed; the TypeScript core and Python discovery run behind separate HTTP APIs, Cognito provides identity, and Aurora PostgreSQL Express 17.9 stores the core data. Migrations 1–4 and separate IAM-only SQL roles are verified with TLS; the runtime role cannot create schema objects or alter migration history. The owner approved **US$10 monthly usage alerts**, saved and verified at US$5/8/10 actual and US$10 forecast. The Free Tier API initially showed US$100 remaining and later **US$160**, still on the Free Plan expiring 21 April 2027; no plan upgrade was made. All 63 core tests, 51 Python tests, infrastructure checks and eight live backend groups pass, including real Cognito login, private-trip invitation/access denial and persistence in a fresh Lambda version. Temporary test accounts were removed. Vercel/browser, restore and production-launch gates remain open; public signup remains disabled. See [operating guide](infra/README.md), [hosting decision](docs/decisions/2026-10-21-aws-development-backend.md) and [verification](docs/verification/07-aws-backend.md). Product features remain Cursor's separate work.

**Website deployment update (26 October 2026):** The repository is on GitHub and the `apps/web` Next.js app is live in Dushyant's Vercel Hobby workspace at [goa-intenary.vercel.app](https://goa-intenary.vercel.app/). GitHub Actions passed on commit `7ca2841`, including the migration-history test corrected for migration 004. Vercel has Cognito and AWS API settings, `ENABLE_LOCAL_DEMO=false`, and the exact production `APP_ORIGIN`; the latest production redeployment is Ready. In a live browser, the landing page loaded, Explore received all 16 reviewed places and map pins from the discovery API, and My trips required sign-in. This is a public showcase with invite-only account access: public Cognito signup remains disabled. A full private trip/browser journey, mobile/GPU/keyboard acceptance, backup restore and broader production release gates remain open. See [deployment verification](docs/verification/2026-10-26-vercel-deployment.md).

**Place search (26 October 2026):** Named Goa places come from the reviewed catalogue and from Photon/OpenStreetMap. When `PHOTON_API_URL` is unset, discovery uses the public Photon demo, including on Lambda, with the existing timeout, cache and one-new-query-per-second limit. Streets, boundaries and the state itself are left out. A search that only matches those says it is too broad and asks for a beach, fort, station, market, restaurant, viewpoint or town. Palolem Beach is kept even when Photon labels its type `other`. The live site still shows “That resource is unavailable” on Today, Checklist, Bookings and plan detail until the core API that is actually running is the build that registers those routes; the routes themselves are in this repository and answer locally.

**Slice 03 update:** the owner requested the missing map and bills split between selected travellers, including named guests. Local implementation now includes matching Explore/day Leaflet pins, optional custom coordinates, selected-person equal/custom shares, guest records without access rights, exact balances, advisory settle-up and manual repayment records. Existing expenses remain unallocated until explicitly split. See [contract](docs/slices/03-map-and-splits.md) and [handoff](docs/slices/03-handoff.md). Automated/API checks are recorded there; browser map/mobile verification and cloud gates remain open.

**Slice 04 update:** map panels now contain debounced source-labelled place search, selectable results, dynamic pin focus and direct itinerary/saved-place actions. Public search combines the reviewed catalogue with bounded Goa Photon/OpenStreetMap results; Palom resolves to Palolem. Private planning reuses the current trip/day and existing authorised activity writes. The final web (15), Python (51), production build and six-group live API checks pass; rendered browser verification remains open. See [handoff](docs/slices/04-handoff.md).

**Slice 06 update (21 October 2026):** Budget & splits is now an expense-first group wallet with a searchable expense feed, visible participant balances and prefilled settle-up records. Forecast/category budget details remain in a separate view. Exact selected-person shares, named guests, audited corrections and manual external-payment records reuse the existing core contracts. Web typecheck, 15 tests, production build and all eight live split integration groups passed; rendered browser acceptance remains open. See [handoff](docs/slices/06-handoff.md), [slice contract](docs/slices/06-expense-workspace.md) and [design adaptation](DESIGN.md).

**Local-first trip-planning half (21 October 2026):** Travel, stays, contacts, checklists, votes, comments, bookings, category limits, itinerary extras, and the Today dashboard are implemented on the existing local app before any cloud deployment. This local feature slice is separate from infrastructure. The infrastructure update above records the AWS development deployment; Vercel/browser and production acceptance remain open.

**Trip-planning batch 1 (21 October 2026):** Accepted members can save flight, train, and bus segments, stays with guests and optional coordinates, organiser, hotel, driver, rental, and activity-provider phone cards, and personal plus shared checklist items. Personal checklist rows stay hidden from other members, including the organiser. The new panels are not on the trip workspace yet. Those four flows passed through the local API after one dev-server restart. The existing Plan, Saved places, Budget & splits, and Your people tabs rendered at 390×844. Web tests stayed at 15 passed. Core tests pass except the frozen `planning.test.ts` migration list, which still expects versions `[1, 2, 3]` after migration 004. See [batch 1 verification](docs/verification/07-trip-planning-half.md) and [browser notes](docs/verification/07-trip-planning-half-browser.md). Cloud acceptance stays a separate gate. No fix was required after the batch 1 browser pass.

**Trip-planning batch 2 (21 October 2026):** Accepted members can mark one Interested vote on a saved place, comment on an activity, and link one booking to an activity, a stay, or a travel segment. The organiser can set a category spending cap. Paid remaining stays the trip budget minus recorded spending. Forecast remaining is the budget minus itinerary estimates. Votes are on Saved places, and the cap controls are in Budget & splits. Comment threads and booking pickers are not on the plan yet. Those four flows passed through the local API. The phone layout was not checked for this batch: the sign-in page did not stay loaded, and a 390×844 override still laid out at 980 pixels. Web tests stayed at 15 passed. Core tests pass except the frozen `planning.test.ts` migration list. See [batch 2 verification](docs/verification/07-trip-planning-half.md) and [browser notes](docs/verification/07-trip-planning-half-browser.md). No product fix was required. Cloud acceptance stays a separate gate.

**Trip-planning batch 3 (26 October 2026):** Each plan card can set a status, choose attendees, save a booking link, and show a comment thread. A cancelled activity stays on the plan. The Today tab lists today's non-cancelled activities, upcoming travel, stays, and contacts, with no weather and no reminders. Those controls were clicked at 390×844 on the local app. The reused trip runs 31 Oct–5 Nov, so an activity for 26 Oct was rejected and Today had no activity for that date. The future flight, the current stay, and the contacts were on Today. Web tests stayed at 15 passed. Discovery stayed at 51 passed, with 16 catalogue places. Core tests pass except the frozen `planning.test.ts` migration list, which still expects versions `[1, 2, 3]` after migration 004. A checklist suite once aborted inside the local database and passed when run alone. See [batch 3 verification](docs/verification/07-trip-planning-half.md) and [browser notes](docs/verification/07-trip-planning-half-browser.md). No product fix was required. Cloud acceptance stays a separate gate.

## 1. Product goal

**Reel ideas update (26 October 2026):** The owner requested a dedicated **Reel** trip section for shared reel and photo inspiration. Accepted members can save an optional Instagram reference, title, selected trip members, place and shot notes, then reopen ideas later. The creator or organiser can edit or remove them. Core API/PostgreSQL owns this data; no Instagram account integration or new infrastructure is needed. See [Slice 08 contract](docs/slices/08-reel-ideas.md) for input, access, migration and acceptance rules. Verification and deployment status are recorded in that slice.

Build a mobile-first website that lets a private group explore Goa, manually plan each day from a map, keep bookings and trip documents in one place, and settle shared expenses. The first usable release should work for a real invited group without requiring a mobile app, social login, automatic itinerary generation, or in-app money transfers.

Success means a group can create a trip, invite members, plan activities, retrieve the right booking, record payments, and finish with correct balances on an ordinary phone.

### Primary users

| User | Main need |
| --- | --- |
| Trip organiser | Create a trip, invite people, keep dates and shared details accurate. |
| Trip member | Find places, contribute plans, see their bookings and expenses. |
| Content administrator | Maintain public Goa places and dated events. |

All trips begin private and invite-only. Public traveller matching is outside the first release.

## 2. Confirmed stack

The user chose **separate backend services using TypeScript and Python** and **Vercel for website deployment**. The initial AWS credit estimate was approximately US$450. On 21 October 2026 the user supplied Billing text showing **US$100 remaining on AWS Free Plan**; that supersedes the initial estimate. The Free Tier API subsequently verified the Free Plan, initially US$100 and later US$160 remaining, with expiry on 21 April 2027. The development resources below have been provisioned and tested without a plan upgrade; do not assume every future service or configuration is eligible.

| Layer | Choice | Reason / boundary |
| --- | --- | --- |
| Website | Next.js, React, TypeScript, responsive design, hosted on Vercel | One web codebase for phone and desktop, with straightforward Vercel preview deployments. |
| Core API | TypeScript with Fastify on AWS Lambda behind API Gateway HTTP API | Owns trips, members, itineraries, expenses, bookings, document access, and administrative actions. Keep feature modules together in this service. |
| Discovery and jobs | Python with FastAPI for public search endpoints, plus separate Python Lambda handlers for scheduled and queued work | Owns the curated Goa catalogue, event search and updates, weather cache, reminders, and document processing. Python API and handlers may share a package while deploying independently. |
| Identity | Amazon Cognito user pool with email/password accounts | Password reset, verification, and password hashing are managed without social sign-in. Do not create a separate password table. |
| Relational data | Development: Aurora PostgreSQL Express 17.9, IAM-only gateway, min 0/max 1 ACU, one-day backups; production configuration remains gated | Trips, participants, itineraries, splits, votes, and bookings have connected data that suits SQL and transactions. Start with one cluster and clearly owned schemas/tables. |
| Files | Private Amazon S3 bucket(s) | Shared tickets and bookings; separate access rules for personal documents. Browser uploads/downloads use short-lived authorised URLs. |
| Async work | Amazon SQS and EventBridge Scheduler | Queue document jobs and trigger reminders or periodic content cleanup without holding an API request open. |
| Email | Amazon SES | Account and trip-related messages when the sender identity and production sending access are ready. In-app reminders come first. |
| Maps | Leaflet with OpenStreetMap-derived hosted tiles; Google Maps links for turn-by-turn navigation | Keeps the interactive trip map flexible. Choose a production-capable tile host before launch. |
| Search | PostgreSQL text and location fields initially | Search the curated catalogue and dated events; add a dedicated search engine only if the catalogue and usage warrant it. |
| Infrastructure and checks | AWS CDK in TypeScript; Git; automated checks and Vercel previews | Cloud resources remain reproducible and changes can be reviewed before release. |

**Design rule:** these are separate deployable backends with clear responsibilities, but they share one project and one database cluster initially. Do not split every feature into its own service. The TypeScript core owns private trip transactions. Python owns public discovery and asynchronous work. If a worker needs private trip details, pass a minimal event payload or use a narrow internal interface; avoid unrestricted cross-service table writes.

**User-visible auth:** email, password, verification, and reset. Cognito stores salted password hashes; the application stores a Cognito user ID and profile fields, never a password or a reversible password copy. Protect browser sessions with secure cookies through the web application rather than leaving long-lived tokens in browser storage. The exact integration will be verified against current Cognito and Next.js documentation during implementation.

**Database decision gate:** confirm a compatible Aurora PostgreSQL version and Data API availability in the chosen AWS region, expected idle time, auto-pause behavior, storage and I/O charges, and a cost comparison against a small RDS PostgreSQL instance. Aurora auto-pause can reduce instance-capacity charges while idle, but storage and other charges remain. Do this comparison before provisioning. If Aurora is poor value for the expected usage, keep PostgreSQL and switch the hosting choice; the product design remains unchanged.

**Region:** evaluate AWS Asia Pacific (Mumbai) first for users in India. Select the Vercel deployment region and API route to avoid unnecessary distance between server calls and AWS. Check actual product availability and latency before fixing the region.

### Why this split

The TypeScript API handles requests where consistency matters: joining a trip, changing a plan, recording an expense, or authorising a document. The Python service handles the place catalogue, dated event feed, and jobs such as reminders, document checks, and periodic removal of expired event results. The frontend uses a stable `/api/...` route structure; routing to the correct AWS endpoint is hidden from the user. Both services validate the user where needed, and neither trusts a trip ID sent by the browser without a membership check.

## 3. Core user journeys

1. **Explore before a trip:** browse a public Goa map, search by name/area/category, and inspect place and event cards.
2. **Start a trip:** register or log in, create trip name and dates, set optional budget, then receive a private invitation link.
3. **Join a trip:** open invitation, authenticate, request/confirm membership, then see only trips joined.
4. **Plan a day:** choose a map pin or add a custom location, assign a date and time, set attendees, and reorder manually.
5. **Travel together:** find each person's arrival, the group stay, booking references, contacts, and permitted files.
6. **Spend together:** record payer, participants, amount, and split; review balances; record a repayment.
7. **During the trip:** see today's schedule, relevant event listings, reminders, weather, and quick contacts.
8. **After the trip:** export a readable itinerary and review the final settlement before archiving.

## 4. Feature requirements and acceptance rules

### 4.1 Goa discovery and map

Public places have a name, coordinates, area, category, short description, known amenities, approximate price if available, opening details if available, source URL, and last-checked date. Initial catalogue target: **50–100 reviewed places** across North and South Goa. Avoid claiming complete coverage. An administrator can create, edit, hide, and mark a place as needing verification.

Filters: area, category, trip style, price band, and amenities such as parking, changing rooms, toilets, accessibility, and food preferences where verified. Search works across place name and area. A trip member can save a place or add a private custom pin.

The map displays matching places, accommodation, and numbered stops for a selected trip day. Tapping a place offers **Save**, **Add to itinerary**, and **Open navigation**. A user can plan from the map on a phone without needing a desktop view. Attribution to the map data/tile provider remains visible. Offline map download is not in scope unless a tile provider explicitly supports it.

**Acceptance:** two different trip days show distinct stop lists; changing a stop on the timeline updates the map; a custom pin is visible only within its trip.

### 4.2 Current events

Events are separate from permanent places. Each event has a title, venue/place, local date and start/end time, category, entry details, source, last-checked time, and status. Views: **Today**, **Tonight**, **This weekend**, and **During my trip**. All Goa event times are stored with a timezone and displayed in India time.

An administrator curates or imports a modest number of listings and reviews them. A trip member can add an event link privately. Expired events leave current search results automatically. The app should say **scheduled now** rather than imply live crowd, ticket, or cancellation information. A source and freshness label appear on each event.

**Acceptance:** an event outside its date range does not appear in Today/Tonight; a stale item shows its verification date; a trip member can add a listed event to a day.

### 4.3 Trips, invitations, and membership

A trip has title, start/end dates, optional description and budget, organiser, members, and status. A user may join multiple trips. Invitations use expiring or revocable links/codes and can require organiser approval. An organiser can remove a member; that action revokes future access without corrupting existing expense history. For the first release, the organiser manages trip settings and invitations; accepted members can propose or edit plans, add expenses, and upload shared bookings. Sensitive actions have a visible audit trail.

**Acceptance:** someone with a copied trip ID but no membership cannot read private trip data; revoking an invitation prevents new joins; removing a member ends their shared-document access.

### 4.4 Manual itinerary and timeline

Every day has ordered activities and an unscheduled list. An activity includes title, linked place or custom coordinates, date, optional start/end time, attendees, notes, estimated cost, status, and optional booking/document link. Users can add, move, reorder, edit, and remove activities manually. An overlap warning informs rather than automatically changes the plan. Plans may contain both whole-group and subgroup activities.

**Acceptance:** a member can plan a three-day trip using only the map and timeline; reordering persists for other members; time and attendee choices survive refresh.

### 4.5 Group wishlist, voting, and activity comments

Members save candidate places to a group wishlist and mark **Interested** once per place. Show count and voter names. Votes guide discussion; they never schedule an activity automatically. Activities have a small comment thread with author and time. Members can edit or remove their own comments; organiser moderation is available for the trip.

**Acceptance:** duplicate votes do not inflate counts; removing a candidate does not delete an already scheduled stop; comments remain attached when an activity changes day.

### 4.6 Expenses, budgets, and settlements

Each expense contains description, INR amount, payer, included participants, date, category, optional receipt, and an equal or custom split. The app supports one payer per expense in the first release; multiple payers can enter separate expenses. An expense affects actual spending only after someone records payment. Planned activity costs feed the forecast budget separately.

Balances equal **expenses paid minus allocated share plus repayments sent minus repayments received**, using a consistent ledger model. Show total spent, category totals, each member's paid amount/share, and a minimal set of suggested repayments. Members can log an external repayment by UPI/cash/other, with payer, receiver, amount, date, and reference. The app records it; it does not move money. Edits and deletions are logged, and the ledger recalculates.

Set a total trip budget and optional category budgets. Show estimated remaining, actual remaining, and overspend clearly. Do not add estimated costs to the debt ledger.

**Acceptance:** if A pays ₹4,000 for four included people, each share is ₹1,000 and the three others owe A ₹1,000 before other transactions. Non-participants owe zero. The sum of all balances is zero after every expense or repayment. Editing a split recalculates all affected balances.

### 4.7 Travel, stays, tickets, documents, and contacts

Travel entries cover flight/train/bus or other arrival/departure, traveller(s), date/time, station/terminal, booking reference, and optional ticket. Stay entries cover property, map location, check-in/out, assigned guests, contact, and booking confirmation. Activity bookings attach to itinerary items. Quick contacts cover organiser, hotel, driver, and rental or activity provider, with tap-to-call where available.

Store shared booking PDFs/images and text notes in the trip. Store personal tickets/IDs separately, private to the owner unless explicitly shared. An organiser role alone does not reveal a personal ID. Allow owner deletion and account/trip retention controls. Use a private S3 bucket, short-lived authorised URLs, content type and size limits, file checks before general availability, and access logs for sensitive files. Identity documents should be optional. Encourage masked Aadhaar where suitable; avoid requesting a full Aadhaar number as a profile field. Consider a fresh sign-in check before opening a personal ID.

The downloadable itinerary is a readable PDF of selected schedule, places, accommodation, and selected contacts. It excludes personal identity files and private notes by default. A PDF is a backup for reading the plan; it does not provide offline map tiles.

**Acceptance:** a non-member cannot obtain a file URL; one member cannot see another's private ID; a shared hotel confirmation is available to accepted members; expired file URLs fail. Removing a member blocks new URLs immediately; previously issued direct S3 URLs may remain usable until their short expiry, so choose a protected download endpoint for files that require immediate revocation.

### 4.8 Checklists, reminders, and weather

Each trip supports a personal checklist and a shared checklist. Shared tasks may have an assignee and completion state. Reminders highlight travel departures, check-in, and booked activities in the app; users choose reminder timing. Add email delivery after sender setup and production sending access are ready. Avoid sending private document details in reminder email.

Weather displays an area forecast, provider attribution, and last-updated time. If the trip date is beyond the forecast window, show **Forecast not available yet**. Weather informs decisions; it never silently rewrites the itinerary.

**Acceptance:** a checked item is visible to the intended members; reminder times respect India time; a forecast does not appear as a fact for an unsupported future date.

### 4.9 Authentication, privacy, and account controls

Provide email/password registration, verification, login/logout, forgot password, change password, and account deletion. No OAuth or social login. Restrict all trip API calls by authenticated membership and all administrator calls by an explicit admin role. Rate-limit login and invitation attempts. Use HTTPS, secure session handling, least-privilege AWS permissions, encryption in transit/at rest, backups, and monitored errors without document contents or passwords in logs.

Define retention: users can remove their personal uploads; an archived trip remains visible to members for a defined period; deletion and financial-record handling require a written policy before launch. Do not launch the ID vault until private/shared permissions and file access tests pass.

### 4.10 Reel and photo ideas

Each private trip has a **Reel** section for Reel or Photo ideas. An accepted member adds a title, an optional HTTPS Instagram URL, one or more accepted members who want to take part, and optional place and shot notes. Saved ideas remain visible to accepted trip members after refresh and can be reopened at the destination. A creator or organiser can edit or delete an idea. Member selections express participation only; they do not schedule activities. No Instagram credentials, media upload or automatic content fetching is required.

**Acceptance:** Aman saves a Palolem sunset reel with an Instagram reference, selects Aman and Riya and adds a shot note. Riya sees the same idea after refresh and can open the reference. Photo ideas can be saved without a URL. Outsiders, pending members and removed members cannot access ideas; selecting someone from another trip is rejected.

## 5. Screen map

| Screen | Key content and actions |
| --- | --- |
| Explore Goa | Search, filters, place/event cards, public map. |
| My Trips | Create, join, reopen, and archive trip entry points. |
| Trip Overview | Today's plan, dates, budget summary, weather, reminders, contacts. |
| Map & Planner | Day selector, pins, unscheduled list, timeline editing, PDF export. |
| Wishlist | Saved places, votes, Add to day. |
| Expenses | Add/edit expenses, category budget, balances, repayment log. |
| Travel & Documents | Arrival/departure, stays, bookings, shared and personal files. |
| Checklist | Group and private tasks. |
| Reel | Saved reel/photo ideas, Instagram references, selected people, place and shot notes. |
| Members & Settings | Invitations, roles, trip details, notification preferences. |
| Admin | Curate places and dated events, see stale/expired items. |

On phones, keep the main trip navigation to Overview, Plan, Expenses, and Documents; place secondary views in a clear trip menu.

## 6. Data ownership and high-level records

| Owner | Main records |
| --- | --- |
| Cognito | Sign-in identity and password hash. |
| Core API | Profiles, trips, membership, invitations, itinerary, wishlists/votes, comments, budgets, expenses, repayments, stays, bookings, file metadata, contacts, checklists, reel/photo ideas and selected members. |
| Discovery service | Public places, amenities, event listings, source/freshness metadata, weather cache. |
| S3 | File bytes for tickets, confirmations, and personal uploads. |
| Queue/scheduler | Job requests and reminder triggers; durable business data stays in PostgreSQL. |

Every private record carries an owner or trip association. Financial amounts use integer paise or a fixed decimal type, never floating point. Record creation/update timestamps and the actor for consequential edits. Public place and event records include source and last verification time.

## 7. Delivery sequence

| Stage | Deliverable | Exit check |
| --- | --- | --- |
| 0. Decisions and cost gate | Final screen flows, AWS region, database cost comparison, credit eligibility/expiry, tile provider, email sender and document retention choices. | A reviewed architecture and budget ceiling exist before services are provisioned. |
| 1. Foundation and private trips | Repository, Vercel preview, AWS infrastructure definitions, Cognito account flow, private trip creation/invitations/membership, logging and budgets. | Two users register and log in on a preview, join one trip, and an outsider cannot read it; no credentials leak. |
| 2. Discovery | Initial curated catalogue, map, filters, event admin and dated search. | Reviewed places show sources/freshness in consistent map/list results; sourced events obey date windows. |
| 3. Planning | Day timeline, custom pins, unscheduled list, wishlist/votes/comments, stays and travel entries. | Group completes a sample three-day Goa itinerary and sees changes across accounts. |
| 4. Money | INR expense ledger, equal/custom splits, budgets, repayment recording. | Example and edge-case balances reconcile to zero. |
| 5. Documents and utility | Shared/private uploads, checklists, contacts, PDF itinerary, reminders, weather. | Access checks, file expiry, export privacy, and time handling pass. |
| 6. Pilot and launch | Mobile usability pass, content freshness workflow, backup/restore check, cost review, monitoring, first invited group. | A real small group finishes the core journey and the owner understands current spend. |

Use a working Vercel preview at each stage. Production release requires the owner's explicit decision about domain, public access, and any paid resources. Infrastructure and content changes should be reversible or backed up.

## 8. Quality gates and example pilot

Run checks appropriate to each feature: unit tests for split calculations and date filtering; API checks for membership and file authorisation; an end-to-end browser path from registration to settlement; mobile layout checks; and a backup/restore drill before launch. Verify that a removed member cannot request new download URLs and that previously issued URLs expire as configured. Review accessibility basics such as readable text, labelled controls, keyboard access, and map alternatives in list form.

Pilot scenario: four invited friends spend three days in Goa. They save and vote on places, schedule beach and club visits, attach one hotel PDF and one private personal ticket, arrive at different times, record a ₹4,000 shared dinner and a three-person activity, settle one UPI repayment, and export the itinerary. A fifth signed-in outsider tries the trip URL and file URL and is denied. The group confirms the plan is usable on phones.

## 9. Operating plan and cost guardrails

1. Verify the credit's eligible services and expiry in the actual AWS Billing console. AWS promotional credits apply only to eligible services and charges after credit exhaustion are billable. The credit does not automatically cover Vercel or map providers.
2. Set AWS Budgets alerts and a modest project spending threshold before deployment; review charges weekly during the pilot. Monitor Vercel separately.
3. Compare Aurora with a small RDS PostgreSQL deployment using the AWS Pricing Calculator or official regional price catalog for the selected region and expected use. Include database compute, storage, I/O, backups, API Gateway, Lambda, S3, email, logs, data transfer, and any VPC networking charges. Use the current account plan/credit facts and do not infer a guaranteed number of months.
4. Limit upload sizes and retain files only as long as useful. Keep public map tiles, weather, and event data within provider terms and usage limits.
5. Assign an owner to event updates. Launch with fewer trustworthy listings rather than a large stale feed.
6. Configure monitoring for failed sign-ins, API errors, queue failures, document processing failures, and unexpectedly high spend. Keep logs free of passwords and document content.

## 10. Open decisions for the owner

These choices do not block the planning files. Resolve them before the relevant stage:

| Decision | Suggested default | Needed by |
| --- | --- | --- |
| Product name and visual style | Goa Together; owner-specified coastal green/ivory/coral editorial system with optional Tubes hero and sticky travel story. | Chosen 21 October 2026 |
| AWS region and database hosting | Mumbai; compare Aurora vs RDS cost. | Stage 0 |
| Map tile provider | Low-cost OSM-derived provider with clear terms and attribution. | Stage 2 |
| Initial Goa catalogue | 50–100 reviewed locations, North and South Goa. | Stage 2 |
| Event maintenance owner | Named administrator; visible last-checked date. | Stage 2 |
| Invitation approval | Organiser approval on by default. | Stage 2 |
| Shared document permissions | Members may upload; organiser may remove shared files; owner controls personal files. | Stage 5 |
| Identity-document retention | Optional uploads; short, explicit retention policy. | Stage 5 |
| Reminder channel | In-app first, email after SES production access. | Stage 5 |

## 11. Release scope and priorities

The first public pilot includes all capabilities agreed in this conversation, delivered in stages. Priority indicates build order and launch gating, not a promise that a partial stage is a complete public product.

| Priority | Included behavior | Why |
| --- | --- | --- |
| P0 — core journey | Email/password accounts, private trips, invitations, Goa map and curated places, manual day plan, shared expenses and balances, travel/stay records, shared bookings | A group can use the app for an actual trip. |
| P1 — complete pilot | Events, wishlist/voting, custom pins, comments, category budgets, repayments, checklists, contacts, personal documents, PDF itinerary | Covers the remaining collaboration and trip-operation needs. |
| P2 — after core reliability | Weather, in-app reminders, email reminders when SES is ready, better filters, richer administration | Adds convenience after privacy and financial checks are sound. |

The complete pilot should include P0 and P1. P2 can be switched on during the pilot as each integration is verified. The following are **not part of this release**: automatic AI trip generation, booking purchases, in-app payments, live location sharing, public matching with strangers, live ticket inventory, real-time club crowd estimates, an offline map download, and a native iOS/Android app. Record requests for them without quietly expanding the build.

## 12. Detailed interaction design

### 12.1 Explore and search

The public Explore page opens with a Goa map and a list that conveys the same places without requiring map interaction. A search box accepts place/event names and areas. Users choose one or more categories and amenities, see active filter chips, clear them in one action, and switch between Places and Events. Place cards show a concise summary, area, source/freshness, and actionable buttons. The map retains the filters when the user pans; it should make clear whether results reflect the current map area or all of Goa.

An unauthenticated visitor may browse public entries. Saving a place, adding it to a trip, voting, or commenting asks them to sign in and then returns them to the intended action. Empty results offer Clear filters and a nearby-area suggestion. Slow or failed place search has a retry state rather than a blank map.

### 12.2 Create, invite, and join

The Create Trip form asks for a name and start/end date, with optional description and budget. The creator becomes organiser. The member screen shows accepted members, pending invitations, approval requests, and a way to revoke a link. Invitation tokens are unguessable, scoped to one trip, expire, and can be disabled. Invite acceptance is idempotent: accepting twice cannot create duplicate membership. If an invitation requires approval, the requester sees Pending until the organiser approves or rejects. A person who already belongs to the trip lands in the trip instead of creating another membership.

### 12.3 Plan from the map

Selecting a pin opens a compact detail sheet. Add to itinerary asks which trip (when the user has more than one), which day, time or Unscheduled, attendees, and optional note. The planner shows one day at a time, a numbered stop list, and the same numbered pins on the map. Users may reorder, change time, move a stop to another day, or convert it back to Unscheduled. Editing a public place in the catalogue later does not erase trip-specific notes or times. A deleted public place becomes an archived reference in an existing itinerary until a member removes that activity.

On phones, the map and the day list can switch focus while staying in the same planner. Every map-only action has a list/form equivalent for accessibility. A temporary connection failure keeps unsaved edits visible and tells the user whether they were saved.

### 12.4 Money during and after a trip

The expense form defaults participants to the full accepted group but makes exclusions obvious. It shows each person's calculated share before Save. A custom split must sum exactly to the expense total. The balances view explains the result in plain language: “Riya should pay Aman ₹850,” along with the expense history behind it. Suggested settlements are advisory; recording an external repayment requires payer, receiver, and amount. Each member can inspect and correct their own entries; edits to another person's entries follow the agreed permissions below and retain history.

### 12.5 Documents at the point of need

A travel/stay/activity record has an obvious Attach document action. Files are labelled as Shared with trip or Private to me before upload. The Files view filters by ticket, stay, activity, receipt, identity, and note. A file card shows owner, visibility, related booking, upload time, and status. If processing is incomplete, the card says Processing; if rejected, it explains how to replace the file without exposing technical details. The owner can remove an upload; shared-booking removal by the organiser is logged. The itinerary export includes links or references only to content that its requester is allowed to see and excludes identity documents by default.

## 13. Roles and access matrix

Use server-side checks for every action. “Own” means created or personally uploaded by that account. A trip may have more than one organiser later, but the pilot can begin with one.

| Action | Visitor | Accepted member | Organiser | Content admin |
| --- | --- | --- | --- | --- |
| Browse public places and published events | Yes | Yes | Yes | Yes |
| Create a private trip | After sign-in | Yes | Yes | Yes, as a traveller |
| Read a private trip or shared booking | No | Own trips only | Own trips only | Only if separately a member |
| Invite, approve, remove members | No | No | Own trip | Only if separately organiser |
| Add/edit an itinerary item | No | Own trip | Own trip | Only if separately a member |
| Add an expense | No | Own trip | Own trip | Only if separately a member |
| Edit/delete an expense | No | Own entry; rules for settled entries below | Own trip, with audit | Only if separately a member |
| View settlement and repayment history | No | Own trip | Own trip | Only if separately a member |
| Read shared trip files | No | Own trip | Own trip | Only if separately a member |
| Read personal ID file | No | Owner only | Owner only | Owner only |
| Publish/edit Goa catalogue or events | No | No | No, unless also admin | Yes |

An organiser may manage trip membership and shared files but does not inherit access to another member's private documents. A removed member is denied new reads and new document URLs immediately; any previously issued direct S3 URL lasts until its short expiry. If a file needs immediate revocation, deliver it through an authenticated endpoint that checks access on every request. Content admins manage only public catalogue data; their role does not grant private trip access.

Expense edit rule for the pilot: the creator may edit their own expense while no repayment depends on it. If a repayment has been recorded, editing or deleting a related expense requires an explicit warning and a corrective entry or organiser action with audit history. Never silently erase a repayment. A removed member's historical paid/share amounts remain in the ledger; the organiser can settle their outstanding balance, but cannot impersonate them.

## 14. Data model and invariants

These are conceptual records; final table names can follow the selected database conventions. Each row with private data includes the user or trip scope needed for authorization and audit timestamps.

| Record | Essential fields / relationship | Invariant |
| --- | --- | --- |
| Profile | Cognito subject ID, display name, email, preferences | No stored password. Cognito subject is unique. |
| Trip | ID, organiser, title, start/end, status, currency, budget | Start is on/before end; currency is INR in the pilot. |
| Membership | Trip, user, role, status, joined/removed time | One current membership per user and trip. |
| Invitation | Trip, token hash, expiry, revoked flag, approval requirement | Token is never stored or logged in clear after creation. |
| Place | Coordinates, area, category, amenities, source, verification date, publish status | Public catalogue ID remains stable for existing itinerary references. |
| Event | Place/venue, start/end, timezone, source, status, checked time | End follows start; expired events leave current views. |
| Wishlist vote | Trip, place, member, vote | At most one active vote per member/place/trip. |
| Activity | Trip, day, order, place/custom location, attendees, times, estimate, status | Date belongs to trip or is explicitly marked outside-trip; order is stable. |
| Comment | Activity, author, body, timestamps | Author and organiser edit rules are enforced. |
| Expense | Trip, creator, payer, amount, category, date, state, audit version | Amount is positive integer paise; one payer initially. |
| Expense share | Expense, participant, allocated paise | Shares sum exactly to expense amount. |
| Repayment | Trip, from member, to member, amount, method, date | Positive amount; separate from trip spending. |
| Stay / travel / booking | Trip, travellers/guests, times, location, provider, reference | Booking may attach to an activity and multiple attendees. |
| Document metadata | S3 object key, owner, trip, visibility, category, status, linked record | No public bucket ACL; access derives from owner/membership. |
| Checklist item | Trip, scope, creator, assignee, completion | Private items visible only to owner. |
| Reminder | User, source activity/booking, due time, channel, state | One active reminder per user/source/time/channel. |
| Audit entry | Actor, trip, action, target, timestamp, safe summary | Append-only; no secret or document contents. |

Keep public catalogue data and private trip data in separately owned schemas or clearly named table groups. If both backends use one cluster, each has database credentials with only the permissions it needs. Schema changes use versioned migrations. Avoid service-to-service writes into tables owned by the other backend; define an API/event or a documented exception.

### Expense calculation example and edge cases

For each member, define **net balance = expenses paid − expense shares owed + repayments sent − repayments received**. A positive balance means the member should receive money; a negative balance means they owe. This makes all member balances sum to zero. For a ₹4,000 dinner paid by Aman and split across four people, Aman starts at +₹3,000 and each other member at −₹1,000. If Riya pays Aman ₹1,000 outside the app and the repayment is recorded, Riya becomes ₹0 and Aman becomes +₹2,000.

Equal split rounding distributes leftover paise deterministically among included members and stores the resulting per-member shares, rather than recalculating with floating point. A custom split is rejected unless its shares add exactly to the amount. Reject a split with no participants, a zero/negative amount, or a payer who was never part of the trip. The payer need not be included in the beneficiaries. A late joiner is not silently included in historical expenses. Test edits, removals, partial repayments, and multiple overlapping group subsets. Settlement suggestions must never change the ledger until members record a repayment.

## 15. API and service contracts

These are domain contracts, not final route syntax. The implementing agent should publish a small versioned API description and request/response examples before building each slice.

| Service | Contract group | Required behavior |
| --- | --- | --- |
| Core API | Account profile and trip membership | Resolve Cognito identity; list only joined trips; create trips; accept/revoke invitations; approve/remove members. |
| Core API | Planning | Create/update/reorder activities, custom pins, attendance, wishlist votes, comments, stays, travel, checklists. |
| Core API | Money | Create/update expenses and shares atomically; return summary and balances; record repayments; enforce idempotent writes. |
| Core API | Documents | Authorise upload intent, receive completion/status, issue authorised view/download grants, delete metadata and objects safely. |
| Discovery API | Places/events | Public filtered search, detail, sources/freshness; admin create/edit/publish endpoints. |
| Discovery API | Weather | Return cached area forecast with source/update time and an unavailable state. |
| Python workers | Queue/schedule events | Process uploaded file, expire events, refresh approved content, and issue due reminders with idempotency. |

For private requests, the service validates the authenticated user and the trip relationship, then checks the specific action. Do not trust role, user ID, or trip membership sent in a request body. Use consistent error responses: unauthenticated, forbidden, not found, validation error, conflict, and retryable service failure. Avoid revealing that a private trip or document exists to a caller without access. Paginate public search and trip activity lists when they grow. Version write contracts before changing clients already deployed on Vercel.

The web app may route `/api/trips/...` to the core service and `/api/discovery/...` to Python behind its own domain; preserve one stable browser-facing origin where practical. Calls between services carry only the fields needed for the job. Queue messages contain IDs and safe context, not passwords, full ID documents, or unnecessary personal data. Define retries, a failure queue, and a way to inspect/replay failed jobs safely.

## 16. Security, file lifecycle, and data retention

### File lifecycle

1. The user selects type and visibility, and the core API checks membership/ownership and limits.
2. The API creates a pending metadata record and an object key that does not expose a personal name or booking reference.
3. The browser uploads directly to private S3 using a short-lived, scoped grant. The grant limits object key, size, and allowed content type.
4. A completion event queues a Python processing job. The worker checks actual file type and basic safety rules, then marks it Ready or Rejected. A failed job is visible for retry or replacement.
5. The user requests a view/download. The core API checks owner/membership and document state before granting short access. Sensitive files can use a protected path for immediate revocation.
6. Deletion hides the record promptly, invalidates new access grants, and removes the underlying object according to the retention policy. Backups and logs have their own bounded retention.

Keep personal IDs in a distinct permission category and make their upload optional. Never include them in event feeds, public search, trip exports, or general member lists. Use synthetic sample files for development. Define a user-facing retention period and account-deletion flow before launch; do not promise instantaneous removal from immutable backups.

### Other security rules

Use secure, HTTP-only browser cookies where the chosen Cognito integration allows, protect state-changing browser requests against cross-site request forgery, validate all inputs, and rate-limit sensitive endpoints. Use least-privilege AWS roles, private buckets, encryption at rest/in transit, and separate development/production settings. Store secrets in managed secret storage rather than repository files. Audit membership changes, file access decisions, expense edits, and admin content changes without logging raw sensitive values.

## 17. Content operations, reliability, and acceptance

### Goa content workflow

Start with a curated seed list maintained by an administrator. Each entry has its source and a review date. A content admin can mark it Draft, Published, Needs review, or Hidden. For events, publish only listings with a concrete schedule and source; automatically remove expired events from current search while retaining them for admin history. Show a visible last-checked date, especially for prices, hours, and event details. User-submitted places remain private to the trip until reviewed for public publishing. Do not scrape or copy third-party content outside its usage terms.

### Reliability and performance targets for the pilot

- The app remains usable on a typical mobile connection: list results appear progressively, the map can fail without hiding the itinerary, and saving a plan gives clear success/failure feedback.
- Account, money, and document writes are atomic or safely retryable. Duplicate button taps cannot create duplicate invitations, repayments, or file records.
- Failed scheduled work is observable and retryable. An event expiration or reminder failure cannot corrupt trip data.
- Backups are configured before real documents or expenses are stored; a restore procedure is rehearsed before public launch.
- Measure API errors, slow requests, queue failures, file processing, content staleness, and cloud spend. Set alert thresholds after observing pilot traffic.

### Stage handoff checklist

An implementation stage is complete only when its user journey works in a Vercel preview against the development AWS environment, its private data boundaries have been checked with multiple accounts, its main edge cases have automated coverage, and its operating notes explain any new AWS resources and expected charges. The owner can then review the actual behavior before the next stage. The final pilot should use at least four invited accounts and one non-member account to reproduce the scenario in section 8.

### Decisions log for future work

When changing a choice such as Aurora versus RDS, map hosting, document access mode, or event source, record: decision date, reason, alternatives considered, cost effect, user-visible effect, and migration/rollback path in `docs/decisions/`. Update this plan's stack table so it describes the current agreed direction. An agent should not treat a proposed option as a provisioned resource.

## 18. References checked for this planning baseline

- [AWS Cognito password storage and recovery](https://docs.aws.amazon.com/cognito/latest/developerguide/managing-users-passwords.html)
- [Aurora Serverless v2 auto-pause behavior and remaining charges](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)
- [Aurora Data API regional and engine support](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.Data_API.html)
- [AWS promotional credit terms](https://aws.amazon.com/awscredits/)
- [Amazon SES production sending access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
- [OpenStreetMap public tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [Google Maps Platform pricing overview, for later comparison](https://developers.google.com/maps/billing-and-pricing/overview)

This document is a product and architecture plan, not a promise that each third-party service will be free or that all listings will be live. Verify provider conditions again at implementation time.
