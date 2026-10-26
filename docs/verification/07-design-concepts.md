# Design concept check

## Follow-up pass — 26 October 2026

This pass changed the five built screens so a 390px layout follows the concept hierarchy. Nothing was deployed, pushed, or committed. No `.env` edit, no cloud resource, and no second `dev:local`. The concept PNGs were missing from the working tree and were restored from git so they could be compared. `planning.test.ts` was not edited.

Measured in cursor-ide-browser after `Emulation.setDeviceMetricsOverride` (390×844, mobile): `innerWidth` 390, `innerHeight` 844, `visualViewport` width 390, `documentElement.scrollWidth` 390, `documentElement.clientWidth` 390. That measurement was repeated on the plan, on Budget & splits, on Checklist, and on Today. The phone layout was checked. The Next.js dev overlay reported a hydration mismatch on `shell.tsx` whose diff is the browser tool’s `data-cursor-ref` attributes. That overlay is not a trip-data change. Its badge sat on top of the leftmost dock label.

Signed in with the synthetic Aman button. Opened **goa with friends**. Clicked Budget & splits, Your people, Checklist, and Open itinerary. The Today dock label was covered by that dev badge, so the pointer click was intercepted; the Today button’s own action then opened `?tab=overview`. Plan card check was still on Day 01 after returning to the plan.

### What changed

- At 800px and below, the ten-tab strip is replaced by a five-item dock: Today, The plan, Budget & splits, Your people, Checklist. Saved places, Travel, Stays, Bookings, and Contacts stay under “More on this trip”.
- Budget & splits stacks three summary cards, uses a coral Add expense, groups the feed by day with a day total, keeps the category icon, and shows the guest sentence without opening the help disclosure. The ₹100 Chai bill, ₹0 balances, and the ₹30,000 budget were the existing ledger.
- The plan uses D01-style day chips, puts the map with the day, and keeps status, attendees, booking, and comments behind “Status, people, booking, and comments”. Add a plan is coral.
- Your people titles the accepted list, puts Remove inside the member menu, and shows the invite card with a small coast illustration. Stored invitation tokens are still not available to copy again.
- Checklist is titled Notes & to-dos, with All / Open / Done, a 1 of 2 progress bar, Created by and Assigned to initials, and the line “Small steps. Bigger memories.” Open hid the packed shared item and left Aman passport. The list does not say who packed an item, because the saved row has a time and no completion actor.
- Today is a dashboard from `GET /v1/trips/:tripId/overview` plus the trip already loaded on the page and `GET /budget` for the spending figure. Visible groups: Next up (empty for 26 Oct, which is outside 31 Oct–5 Nov), Upcoming travel (BOM to GOI), Your people (Aman, Riya), Trip at a glance (6 days, 2 members, 2 plans), Shared spending (₹100 recorded, ₹30,000 budget, ₹500 planned, 0.3% of the budget), Stay (Current stay check, Calangute House, Panaji Room, and a map for the stays that have coordinates), and Who to call (the five contact cards, with `tel:` links). No weather widget and no reminder widget.

### Scores after this pass

| Concept | Verdict |
| --- | --- |
| Expense workspace | Close |
| Itinerary | Close |
| Members | Close |
| Notes and to-dos | Close |
| Trip overview | Close |

Close means the 390px screen now uses the concept’s groups, hierarchy, and coral actions with the trip’s real data. It is not a pixel copy. The site header, local-review banner, and trip title still sit above each screen. The concepts’ beach photograph, dark sidebar, and notification bell are not on these screens. The bell was not added, because a control with nothing behind it would pretend reminders exist.

390×844 browser pass: yes. Measured layout width: 390 CSS pixels.

## Prior check


Date: 26 October 2026. This pass compared the five concept images in `docs/design/` with the trip workspace in a browser. No feature code, concept PNG, `.env`, or `plan.md` was edited. Nothing was deployed, pushed, or committed. The app was not restyled.

`http://127.0.0.1:3000` was down, so one local app was started from the repo root with `npm run dev:local` and left running. That start rotates the local session secret. Sign-in was done again on `/auth` with the synthetic Aman button. The open trip is “goa with friends” (`a3678922-b570-4166-ae4b-d0caf29c6490`).

None of the five PNGs shows a weather forecast or a reminder list. The trip-overview and notes concepts put a bell in the header. The built header has no bell, and these screens have no weather card and no reminder list. That absence is recorded and is not a miss.

## Browser

A 390×844 browser pass happened.

After `Emulation.setDeviceMetricsOverride` (390×844, mobile), the layout width stayed at 390 CSS pixels on every screen in this pass. Measured values: `documentElement.clientWidth` 390, `innerWidth` 390, `innerHeight` 844, `visualViewport` about 390.4×844. The phone layout was checked. The trip tab strip measured 350px wide inside that viewport, with a scroll width of 1029px. The only fixed element found was the skip link. There is no fixed five-item bottom bar.

## Shared chrome

Every concept pairs a dark green product sidebar on the wide layout with a five-item bottom bar on the phone. The built screens, at 390px, use a light header: the `goa. TOGETHER` mark, an “A” avatar, Explore Goa, My trips, and a local-review banner naming Aman. Sign out is available from that header. There is no dark sidebar and no Overview / Itinerary / Expenses / Members / More bar.

Inside the trip, one horizontal tab strip scrolls sideways. At 390px the visible tabs are The plan, Saved places, and Budget & splits. Your people begins at the right edge, and Today, Travel, Stays, Bookings, Contacts, and Checklist continue off-screen. The strip is the same on every tab below.

Above the strip, every tab shows the same hero: “YOUR PRIVATE GOA GETAWAY”, “goa with friends”, “A fresh change of scene. Your kind of company.”, 31 Oct 2026 — 5 Nov 2026, “2 joined · 8 planned”, style chips (Adventure, Beaches, Culture, Food, Nightlife, Relaxation), a sun mark, Edit trip, and a delete control. It is not a beach photograph, and it has no Open itinerary or Invite a friend button. The page ends in a dark green `goa, together.` footer after the content, not a pinned action bar.

## Expense workspace — partial

Concept: `docs/design/expense-workspace-concept.png`. Screen: `?tab=budget`, then the Budget control inside that screen.

Visible matches: the kicker “THE GROUP WALLET”, the title “Trip expenses”, and the line “Shared moments. Fair shares. Everything in one place.” Settle up and Add expense sit with a refresh control. Group spending and Your total share are present (₹100 and ₹100 on this trip). The view switch is Expenses (1), Settle up (0), and Budget. Search (“Search expenses or people”) and a filter (“All expenses”) are on the Expenses view. The filled list is grouped, here as “OCTOBER 2026”, with a row for 31 Oct: Chai, “You paid · 1 person · equal split”, ₹100, and “Your share ₹100”. Group balances lists initials, a role, and a balance: Aman (you) Member, Guest One Guest, and Riya Member, each ₹0 settled, plus “All allocated bills are balanced” and “Add a named guest”.

Visible differences: the first summary reads “Your balance” and “You’re all settled on allocated bills”, ₹0, because this ledger is settled. It is a full-width dark green card; Group spending and Your total share sit side by side under it. Add expense is a dark green button in the header and again under the list. It is not a coral button and it is not pinned to the bottom. The list is a month group with a date badge, not a day heading with a day total and a category icon. The filter is a dropdown, and the row has no category icon. The side column is titled “Group balances”, stacked under the list at this width. The guest sentence is behind “About members & guests”; that disclosure was closed, so the concept’s always-visible guest footnote was not on screen. There is no expense bottom nav.

The Budget control replaces the list with “Keep the trip on budget”: Set category limits, Edit budget, trip budget ₹30,000, remaining ₹29,900, forecast remaining ₹29,500, “₹100 recorded spending of ₹30,000 budget”, “₹500 planned in your itinerary”, and the line that estimates never add to paid spending or anyone’s balance. Spending by category shows accommodation (limit ₹8,000), transport, and food (₹100 paid). That view is a forecast. It is not the concept’s open Expenses picture. The Settle up view was not opened; its control showed a count of 0.

## Itinerary — partial

Concept: `docs/design/itinerary-concept.png`. Screen: the plan, with no tab query.

Visible matches: a day rail and a selected day. At 390px the rail shows DAY 01, Sat, 31 Oct, “1 plans”, selected, and DAY 02, Sun, 1 Nov, “0 plans”, with the next chip cut off on the right. The rendered page also includes DAY 03 through DAY 06 and Unscheduled (“A LITTLE ROOM FOR LATER”, “1 ideas”), further along that rail. The selected day is the heading “Sat, 31 Oct”, with Add a plan and a refresh control. The copy says to build the day by hand and that arrow order is separate from the time labels. A Goa map sits on the page, with Leaflet and OpenStreetMap attribution, zoom controls, and the line that numbered pins follow the list. The filled day continues into a card: order “01”, category Other, “Time is open”, title “Plan card check”, “₹0 estimated”, up and down controls, edit, delete, Move to this day, and Status “Planned”.

Visible differences: there is no Share trip control, no member-avatar row, and no Overview / The plan / Map / Ideas / Costs subnav. The chips read DAY 01 plus the date, not D01. The map is a full-width block under the day heading, titled “This day on the map”, with “0 pins” and a search field (“Find your next stop”). It is not inset beside a timed list, and this day’s card has no numbered pin. The card is a form-like block, not a compact timed row. Who is coming is a checkbox list (Aman, Guest One · Guest, Riya) with Save attendees, not overlapping initials. Activity booking (provider, reference, notes) and comments follow. There is no bottom nav.

## Members — partial

Concept: `docs/design/members-concept.png`. Screen: `?tab=people`.

Visible matches: “Your little circle”, a count of 2, and “Only accepted members see this trip.” Accepted rows use an initial, the name, and a role: Aman (you), Trip organiser, with an ORGANISER badge; Riya, Trip member. The invitation card uses “Good company starts with an invitation.” and Create invite link. At 390px the card stacks under the member list. An existing link is listed with an expiry (“Invitation 1”, “Expires 28 Oct · approval required”, Active).

Visible differences: the privacy line continues, “Planned traveller count is a separate planning number; it never grants access.” A “You manage access” badge sits by the kicker. Riya has Remove. There is no ⋮ menu. This trip showed no Waiting for approval group, so Approve and Decline were not on screen. Create invite link is dark green. The card has a link icon and the lines “Create a private link…” and “Organiser approval is always required.” There is no palm illustration and no stored “Trip invite link” row with a copy control. Existing links are a separate “Invitation links” list with Revoke. There is no bottom nav.

## Notes and to-dos — partial

Concept: `docs/design/notes-todo-concept.png`. Screen: `?tab=checklist`.

Visible matches: a checkbox list split into a private group and a shared group. Personal is first, with “Only you can see these, including from the organiser.” and one open row, “Aman passport”, “Still to pack”. Shared is second. “Pack the charger” is checked, struck through, marked Packed, “For Riya”, with “Packed 21 Oct 2026, 9:40 pm”. Edit and Remove are on both rows. Add an item is the add action. At 390px the two groups stack, personal then shared.

Visible differences: the title is “Packing and tasks”, kicker “PACKING AND TASKS”, and the intro is “Personal items stay on your list. Shared items are visible to everyone who has joined.” Add an item is a dark green button beside that intro. It is not a full-width coral bar. There are no All / Open / Done chips, no “3 of 7 done” line, and no progress bar. Rows do not show Created by or Assigned to as separate initials. The shared row says “For Riya” and a packed time. It does not say who packed it. There is no “Small steps. Bigger memories.” illustration and no header bell.

## Trip overview — miss

Concept: `docs/design/trip-overview-concept.png`. Screen: `?tab=overview`.

The concept is a trip home: a beach photograph with Private trip, the trip name, dates, place, length, and a short line; Open itinerary and Invite a friend; then Next up, Your people, Trip at a glance, Shared spending, Stay, and a Goa map.

Today is a different screen. The visible title is “Today”, kicker “TODAY IN GOA”, with “Activities for today’s date in Goa, the next journeys, the stays, and who to call.” The groups on this trip are Today (“There is nothing in Today.”), Upcoming travel (BOM to GOI, Flight, departs 18 Dec 2026, 9:30 am), Stays (Current stay check, Calangute House, Panaji Room, each with check-in and check-out), and Contacts (name, role, and phone, including Spice farm guide and Airport driver). They stack in one column at 390px.

The photograph, Open itinerary, Invite a friend, people initials, days/members/plans glance, spending figure and bar, and map are not on this screen. Stays and today’s activities meet the concept’s Stay and Next up only as plain lists, and Today itself is empty because the trip dates are 31 Oct–5 Nov. The shared hero above the tabs still shows the trip name, dates, and “2 joined · 8 planned”. That is a thin slice of the concept header, on every tab, and it is not this dashboard.

## Scores

| Concept | Verdict |
| --- | --- |
| Expense workspace | Partial |
| Itinerary | Partial |
| Members | Partial |
| Notes and to-dos | Partial |
| Trip overview | Miss |

390×844 browser pass: yes. Measured layout width: 390 CSS pixels (`innerWidth` 390, `innerHeight` 844, `visualViewport` width about 390.4). The local app was started for this pass and left running.
