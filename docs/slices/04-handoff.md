# Slice 04 handoff — dynamic map search and direct planning

21 October 2026. Implements [the map search contract](04-map-search.md) directly in the existing application. No database migration, authentication change, account upgrade or cloud provisioning was needed.

## Working journey

Search inside either Explore's map or a private trip's day map. Debounced suggestions show named places, area/category and source. Arrow keys/Enter select a result; clicking a suggestion or marker focuses its coordinates and highlights the pin. Results are rendered in a dedicated Leaflet layer without creating a fresh map for each query. Existing day numbers stay intact; additional search pins use S labels. A list and cards remain available when tiles fail.

The selected place offers Add to itinerary, Save for later, source and Google Maps links. Add asks for an accepted trip when browsing publicly; a private map uses its current trip/day. The existing activity form lets the user confirm/change day, title, time, costs, notes and coordinates before saving. Successful writes show confirmation and an itinerary link. Source context is kept in the saved notes. Merely searching/selecting never schedules anything; saving for later is a separate action.

The reviewed catalogue remains compatible. The new public Python `/v1/search` combines those records with bounded Goa Photon/OpenStreetMap results and marks their origin. Palom is a search alias for reviewed Palolem, not a new fabricated location. OpenStreetMap result timestamps are labelled retrieved, rather than reviewed business dates. Ratings, opening hours, prices, tours and availability are not invented.

## Actual verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass for web and core during integration. |
| `npm test --workspace @goa/web` | 15/15 pass, including new public search proxy boundaries and map pin merging/manual numbering. |
| `npm run test:discovery` | Final 51/51 pass: existing catalogue plus alias/merge/filters, Goa/state validation, source normalization, cache, provider limits/failures, production configuration and malformed inputs. |
| `npm run build` | Pass: Next.js 16.4.2 production build/application TypeScript and core build. |
| Real public searches through local BFF | Pass: Palom Beach returned four matches including reviewed Palolem; Panaji returned seven mapped OpenStreetMap matches at check time. These are observations, not stable result-count promises. |
| `npm run verify:map-search` | Six groups pass through actual local web BFF, discovery/real Photon, core and persisted PostgreSQL. |
| Rendered map focus, keyboard, phone, animation, browser console | Not tested. Existing browser security-policy denial remains binding; no alternate UI surface was attempted. Source/build/API checks are not rendered verification. |
| Cloud deployment/authentication | Not tested; prior cloud gates remain open. |

The live script verifies selected-place additions on a chosen day, retry deduplication, coordinate/place-ID/source-note preservation after reopening, separate saved-place behavior and outsider/removed-member denial. It creates synthetic fixtures and soft-deletes only its own trip. Private core/financial code was unchanged, so the previous slice's core tests are historical evidence rather than newly claimed runs here. There is no separate independent-agent verification for this slice.

An early oversized pytest fixture generated a Windows-incompatible case identifier; it was corrected with short explicit test IDs. The final suite passes, including oversized-response handling. No product failure remains in the executed API/test scope.

## Provider and operating details

Official [Photon project guidance](https://github.com/komoot/photon) permits modest project use of its demo, with throttling and availability limitations. Its [API documentation](https://github.com/komoot/photon/blob/master/docs/api-v1.md) was checked for search, bounding boxes, language, limits and GeoJSON fields. Official [Leaflet signatures](https://leafletjs.com/reference.html) and installed Next.js lazy-loading guidance were also checked. Firecrawl was unavailable for the Photon read, so official documentation was read using the web fallback.

The local default is `https://photon.komoot.io/api/`. Python sends only the public place query and fixed Goa search parameters, with an application User-Agent; no browser cookies, account tokens, trip IDs or private notes are forwarded. It checks result state/country/coordinates, caps response size/time/result count, rejects redirects and unsafe endpoint configuration, caches queries for thirty minutes (maximum 256), serializes requests at no more than one new upstream query per second, and applies a twenty-second failure cooldown. Failure metadata explicitly distinguishes reviewed-only results from wider search; it never invents a replacement result.

`PHOTON_API_URL` is a server-only discovery setting. A deployed production service must explicitly configure its Photon-compatible provider; the demo is not silently enabled there. Choose capacity, terms and deployment-wide rate controls before public hosting. No public Nominatim endpoint is used and no paid provider was subscribed. Existing OSM tile attribution/cache/referrer rules remain unchanged.

## Review

Preview: <http://127.0.0.1:3000>. Refresh and sign in again after the service restart. Try Explore → map search “Palom Beach” → choose a result → Add to itinerary → choose trip/day/details → Save. The same search is inside a trip's Plan map. Run `npm run verify:map-search` with `npm run dev:local` running to reproduce the live HTTP journey.
