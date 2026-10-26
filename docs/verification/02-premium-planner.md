# Independent verification — premium planner

21 October 2026. Scope: [Slice 02 contract](../slices/02-premium-planner.md). Verifier did not author web, core, discovery or visual feature code; owned only this report and the supplemental HTTP script. All data used was synthetic and local. Stage 0 cloud gates remain open.

**Automated checks and all eight final independent HTTP groups passed. Both live findings were fixed and retested. Browser/GPU/mobile/keyboard checks remain Not tested; the new preview has no owner visual acceptance recorded. Cloud gates remain open.**

## Evidence and provenance

| Check | Status | Evidence |
| --- | --- | --- |
| Independent `npm run typecheck` | Pass | Both web route type generation/TypeScript and core TypeScript completed, exit 0. |
| Independent `npm test` | Pass | Web 12/12 and core 31/31 reported cases passed, exit 0. Web includes six discovery BFF tests, money/day helpers and original security tests; core includes original 15 and planner 16. |
| Independent `npm run test:discovery` | Pass | Actual Python service TestClient suite: 28 passed, exit 0. Windows local socket-pair permission required network escalation; no cloud requests. |
| Final targeted core planner suite | Pass | Independent `node --import tsx --test --test-concurrency=1 test/planning.test.ts`: 16/16 after URL and historical-payer fixes. |
| Targeted web security after auth/navigation change | Pass | Independent security suite 4/4; strict local return-path allowlist, local-mode/origin and streamed-byte checks passed. This rerun is not additional cases in the web total. |
| Full build | Pass (coordinator evidence) | Coordinator reported final clean `npm run build` passing both Next and core workspaces. Verifier did not run a competing build. Coordinator also reported final web 12/core 31/Python 28 checks passing after last UI refresh/input-limit changes. |
| Coordinator `scripts/verify-planner.mjs` | Pass (coordinator evidence) | Final sequential run after the independent supplement: 8/8 actual BFF/core/Python integration groups passed, exit 0. |
| Lint | Not configured | No lint script is configured; no lint pass is claimed. |
| Independent adversarial baseline | Fail, resolved | Pre-fix runtime reproduced both findings below while five other groups passed. Both failures were corrected and the complete final script passed. |
| Final `scripts/independent-planner.mjs` | Pass | Independently executed against final restarted web/core/Python at 3000/4000/4100: 8/8 groups, zero failures, exit 0. No fake API responses or cloud accounts. |

Do not add repeated targeted regression runs to the overall test counts. Framework counts include test containers/nested cases and are reported as emitted, not as uniform independent scenarios.

## Findings and retest record

1. **P2 resolved: organiser correction of historical spending rejected after payer removal.** Create Riya's paid expense, remove Riya, then as Aman PATCH all form fields with unchanged Riya payer and a corrected title. Pre-fix BFF returned 400. Final live retest returned 200 and retained `paidByDisplayName=Riya`; new expenses/changed assignments to removed Riya still returned 400. Core validates only changed payer selection and regression-tests retained history; web now includes the historical payer option when editing. Native form interaction itself remains browser-untested.
2. **Resolved: source URL credentials accepted by stale server.** A saved-place HTTPS URL with synthetic userinfo returned 200 in baseline. Final live retest returned 400 after core validation was tightened; file/executable schemes also returned 400. Username-only and username/password forms passed the independent final database regression suite. Source URLs are never fetched by core; this was stored-input hygiene, not evidence of a server-side URL fetch.

Baseline and final scripts soft-deleted only their own fixture trips and did not clear existing data. No feature fix was authored by verifier. No unresolved Fail remains in the executed HTTP/database scope.

## Acceptance matrix

| Rule | Status | Evidence / limit |
| --- | --- | --- |
| Additive migration preserves v1 records and is repeat-safe | Pass (database tests) | Independent planner suite created v1 trip/member/invite data, applied 002 repeatedly, verified original IDs/data/defaults, and retained existing v1 access checks. Coordinator reported existing `.data/core` upgraded without reset; that exact datastore transition was not replayed by verifier. |
| Extended create/edit/reopen and organiser-only settings | Pass (tests/final HTTP) | Safe defaults, bounded fields, accepted-member count versus planned travellers, organiser edits and member 403 checked. Final independent script updated traveller count and verified recalculated server averages. |
| Manual itinerary CRUD, unscheduled ideas and date bounds | Pass (database/coordinator HTTP) | Add/move/edit/delete, notes/estimate persistence, valid times/coordinates, trip-day bounds and 409 date shortening with existing activities checked. No automatic schedule is inserted. |
| Version conflicts, atomic reorder and cross-trip IDs | Pass (final independent HTTP) | Two simultaneous edits using one version yielded 200/409. Foreign-ID reorder returned 409 with unchanged list; valid reorder preserved time labels and invalidated stale version. Wrong-trip delete returned 404 and foreign child survived. PGlite serializes transactions; deployed PostgreSQL concurrency remains untested. |
| Saved-place uniqueness and explicit scheduling | Pass (tests/final HTTP/coordinator) | Simultaneous saves left one snapshot without scheduling or changing activity count. Explicit add-to-day checked by coordinator. Executable/file/credential URLs rejected. Core never fetches supplied URLs. |
| Exact INR, planned versus paid and remaining budget | Pass (final independent HTTP/unit) | Budget 2,000,000 paise, planned 800,001, paid 125,001 gave remaining 1,874,999. Duplicate expense key returned same expense; malformed/fractional/negative/overflow money and beneficiaries rejected. Category totals reconcile. With seven planned travellers, rounded estimates/spend averages were 114,286/17,857 paise while actual total remained 125,001. |
| Expense creator/organiser permission and audit | Pass (tests/final HTTP) | Member cannot edit organiser record; creator/organiser version checks, immutable history and retained removed-payer provenance checked. Final organiser full-form correction succeeded without changing historical payer; new removed-payer assignments remained denied. No split/share/repayment/debt result is claimed. |
| Pending/outsider/removed privacy on every new family | Pass (tests/final HTTP) | Pending reads denied; outsider existing/unknown activity/saved/budget routes return identical 404; removed reads/mutations denied. Actor/role injection rejected. |
| Repeat-safe trip soft deletion | Pass (tests/final HTTP) | Trip/detail/new child reads and old invitation acceptance hidden; another trip stayed readable; repeated delete 204. Financial rows/audit retained in database tests. |
| Save/reopen after restart | Pass (embedded PostgreSQL tests) | Closed/reopened same file store and verified day/notes/order/version/saved snapshot/paid budget. Actual browser refresh and deployed RDS restart Not tested. |
| Public Python discovery is a real service | Pass (Python tests/coordinator HTTP) | Sixteen curated records, detail/search/category/region/empty results, source/check dates and coordinates checked. No invented live hours/prices/ratings are returned. Exact source-page facts were not independently re-researched by verifier; creator source-review record is separate. |
| Discovery validation, isolation and failure behavior | Pass (live baseline plus unit) | Live invalid/duplicate/control-character filters and POST denied. Independently executed BFF tests prove only Accept header forwarded, known routes/filters, no browser credentials, retryable 503/no-store/Retry-After for network/5xx/invalid JSON/HTML, no fake fallback. Failure was simulated at BFF unit boundary; real service was not stopped. |
| HTML route shells and unauthenticated content | Pass (final HTTP only) | `/`, `/trips`, `/explore`, `/auth`, `/join` and private trip URL each returned 200 HTML; unauthenticated HTML omitted the created private trip title. This does not verify hydration, rendered interactions or visual quality. |
| Source logging, cookie, origin and local-mode boundaries | Pass (source/tests) | Existing protected BFF, byte caps, private no-store, verified fixture auth, HttpOnly cookies and exact origin tests remain passing. Coordinator's final source scan found no localStorage/sessionStorage, credential console logging or public secret variables. Full runtime logs/browser storage inspection Not tested. |
| New preview rendered/usable | Not tested | Owner's earlier confirmation concerned the old preview, before this master-scope change. No new-preview visual confirmation is inferred. |
| GPU/phone/scroll/keyboard/accessibility | Not tested | Existing browser security-policy denial remains binding; no browser or alternate workaround attempted for this slice. |
| Cognito/RDS/AWS/Vercel production path | Not tested | No cloud resources or paid subscriptions created; credit expiry/Free Plan limits/budget and actual deployed authentication/networking gates remain open. |

## Visual source audit — conditional Pass, runtime Not tested

The [visual decision record](../decisions/2026-10-21-premium-visuals.md) describes an original Three.js module rather than shipping the inspected marketplace/reference bundle. Verifier reviewed local code and dependency/build evidence; the decision's remote licence/API research was coordinator-owned.

- `TubesBackground` lazy-imports after intersection, reduced-motion, coarse-pointer, data-saver and hardware checks. Async generation/gone flags prevent obsolete import completion from attaching after cleanup/Strict Mode. Canvas is aria-hidden, tabindex -1 and pointer-events none; foreground controls are ignored by palette-click handling.
- Wrapper owns matched listener references, IntersectionObserver, ResizeObserver, media-query and visibility cleanup. Offscreen/hidden scenes stop animation. Static SVG remains available for loading, unsupported WebGL, reduced motion/coarse pointers and context loss. Hero placement is separate from forms/planner.
- Original engine preallocates four mesh buffers, caps rendered frames at 30fps and DPR at 1.5, reuses vectors, cancels RAF, disposes geometries/materials/renderer and releases context. Source inspection does not prove browser exception paths, GPU allocation/leak behavior or device performance.
- `StackingStory` uses semantic ordered cards and ordinary links, CSS sticky positioning, one RAF-coalesced passive scroll update and matched cleanup. Below 800px/reduced motion, CSS returns cards to normal flow with no recession transform.
- Source preserves brand tokens, original illustrations, fallback fonts, mobile layout rules and labelled controls. Actual sticky clipping, reduced-motion transition, focus, contrast, zoom, 320/390px overflow and animation smoothness remain Not tested.

The illustrative landing day is explicitly labelled inspiration, not a saved itinerary or booking. Budget UI calls averages approximate planning values and explicitly denies debt/settlement meaning. These are source checks, not rendered UI passes.

## Reproduction and remaining gates

Use the coordinator's existing explicit synthetic local server; do not start competing ports or build processes:

```powershell
npm run typecheck
npm test
npm run test:discovery
node scripts/independent-planner.mjs
```

The supplemental script accepts only HTTP localhost/127.0.0.1, writes synthetic fixtures, never prints tokens/cookies, and soft-deletes its own trips after a completed run. Do not repoint it at cloud accounts. Final independent HTTP regression and coordinator build passed; permitted new-preview owner/browser visual review and all cloud acceptance remain outstanding.
