# Slice 03 handoff — map and selected-traveller splits

21 October 2026. Implements the owner's missing-map/subgroup-split request and confirmed support for named guests, under the [contract](03-map-and-splits.md). Work was implemented and verified in this chat; no independent-agent verification is claimed for this slice.

## Delivered behavior

- Explore renders a Leaflet map from exactly the filtered catalogue. A pin selects a place and opens the existing save-to-trip action. Each itinerary day maps coordinate-bearing stops with the original manual timeline numbers; moving/reordering/editing a stop updates the same API-backed data. Custom activities accept optional paired coordinates. Text-only stops and all actions remain available in lists.
- Budget & splits records one payer and only the selected beneficiaries. Equal/custom amounts persist per person, and the payer may be outside the selected group. A ₹4,000 bill among four people produces four ₹1,000 shares even when the trip headcount is eight. Everyone excluded gets zero share for that bill. Equal rounding assigns remainder paise by stable ID; custom totals must match exactly.
- Organisers can add named guests without creating accounts/invitations or granting any trip access. Guests can pay/share bills and be archived while retaining history. A later joined account is kept separate until the group explicitly corrects its bills; no automatic identity matching occurs.
- The authoritative core ledger returns zero-sum balances, advisory transfers and manual external repayment records. Partial repayments reduce balances and never increase spending. Members record their own outgoing repayment; organisers can record guest/historical payments. Corrections after repayment require organiser acknowledgement and retain the original repayment/audit history.
- Existing trips/expenses were preserved. Migration 003 marks old bills not split, rather than inventing beneficiaries. The UI shows the unallocated total and lets users explicitly assign each old bill. Existing budget/headcount averages stay separate from real debts. A closed-store backup was copied under ignored `.data/core-before-splits-*` before local migration; `.data/core` was never reset.

## Actual checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass for web/core during integration; final production build also completed application TypeScript checks. |
| `npm test` | Pass: 14 web and 45 core reported cases. Retains the existing security/private-trip/planner suites and adds map projection/draft preview plus 14 ledger cases including the suite container. |
| Final targeted `test/ledger.test.ts` | Pass after retry-compatibility and extra excluded-payer/four-beneficiary assertions; repeated cases are not added to totals. |
| `npm run build` | Pass for Next 16.4.2 and core after a clean retry. Initial Windows sandbox worker mkdir returned EPERM; generated `.next` was removed within the verified web workspace and the approved clean build passed. |
| `npm run verify:splits` | Eight live groups passed through actual local web BFF, core/PostgreSQL and discovery. |
| `npm run verify:planner` | Eight existing planner integration groups passed against the upgraded runtime. |
| Browser/map tiles/phone/keyboard | Not tested. Existing browser-policy denial remains binding; no alternate surface was attempted. Build/API/source evidence is not rendered UI evidence. |
| Cloud Cognito/PostgreSQL/Vercel | Not tested; account/cost and real-service gates remain open. |

Financial tests include v2 expense/history/retry migration, four selected people in a larger group, payer outside all four, guest custom payer, one-paise allocations, rejected empty/duplicate/foreign/fractional shares, database total enforcement, duplicate expense/repayment submissions, partial repayment, organiser correction/audit, removed/late members, archived guests, pending/outsider denial, soft deletion and close/reopen persistence. Live tests independently recompute the requested amounts from saved API data but were written/run by this slice's implementer. Only synthetic fixtures are used; scripts soft-delete their own trips.

## Map sources, lifecycle and operating limits

Installed Leaflet **1.9.4** and `@types/leaflet` **1.9.21**; no React wrapper or CDN loader. Official [Leaflet API](https://leafletjs.com/reference.html) and [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) were checked on 21 October 2026, together with installed Next.js lazy-loading/CSS guidance.

The client effect dynamically imports Leaflet, cancels obsolete async setup, removes the map/listeners and disconnects ResizeObserver on cleanup. Pin labels use text nodes, not user-supplied HTML. Tile failures display a list fallback message. Source review confirms shared filtered data, manual numbering and no route/time inference; actual browser rendering/cleanup behavior remains untested.

Standard `https://tile.openstreetmap.org/{z}/{x}/{y}.png` is used for modest interactive viewing, with visible attribution and normal browser caching. The image-level `origin` referrer policy sends only site origin, keeping private trip paths out of tile requests despite the site's global no-referrer default. No automated tile scans, offline download, bulk prefetch or proxy was added. A production tile provider/terms/capacity decision is still needed before public hosting. No paid subscription, cloud resources, deployment or account upgrade was created.

## Run and review

The three-service preview is running at <http://127.0.0.1:3000>. Restarting rotated local sessions; sign in again as Aman/Riya. Open Explore for the public map, a trip's Plan for day pins, and Budget & splits for guest management, selected shares, balances and repayments. Use `npm run dev:local` to restart and `npm run verify:splits` with it running to reproduce the live checks.

The main remaining acceptance work is a permitted rendered desktop/mobile/map/keyboard review. Actual cloud accounts/authentication and production tile selection remain the prior separate gates. The core README records migration compatibility and the forward-fix/consistent-backup rollback requirement; v2 binaries must not be used blindly after new guest writes.
