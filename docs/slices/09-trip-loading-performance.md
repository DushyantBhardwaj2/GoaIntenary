# Slice 09 — trip loading performance

**Requested:** 30 October 2026. Reduce repeated frontend requests and private API database connection overhead identified in the live-site latency investigation.

## User journey and contract

A signed-in member opens a trip, reads the plan, opens activity details, switches panels, and saves an edit. The first useful plan should not wait for every activity's attendees, booking choices, and comments. For example, five visible activities must not automatically issue the previous thirty extra detail/list/profile requests.

- **Input:** existing authenticated trip routes, activity IDs and the user's explicit detail-panel actions.
- **Output:** the same authorised trip records and save results, with duplicate concurrent GETs coalesced, common lists reused within the mounted trip view, and optional detail data requested when opened.
- **Data owner:** the TypeScript core API/PostgreSQL continues to own all private data. No schema migration or API response change is planned.
- **Access:** Cognito revocation checks and membership checks remain server-side on every private request. Private responses are not cached persistently or in a shared HTTP cache. Authentication transitions and writes invalidate any in-flight client reuse. No identity or permission decision is cached to improve speed.
- **Database lifecycle:** standalone SQL and transactions in one HTTP request may reuse one connection. Transactions remain isolated and serial on that connection. IAM connections are destroyed when the request completes, including failures, so idle Aurora can still pause.
- **Failure:** permission/session errors remain visible and failed writes never appear successful. Cleanup must run on error paths. Search retains previous results while the next query loads and reports provider failures.

## Acceptance and verification

1. Concurrent identical private GETs perform one network request; writes and account changes prevent stale in-flight results being reused. A subsequent independent private read reaches the server again.
2. Rendering several activities does not automatically fetch their optional details. Opening details keeps comments, attendees, status and booking changes usable without repeating the current-user request or whole-trip lists per card.
3. A private API request uses one lazily acquired PostgreSQL connection for its SQL work; concurrent requests use separate contexts. Failed transactions roll back and request completion destroys the IAM connection.
4. Existing member/outsider/removed-member and exact-money tests pass, along with web/core type checks and a production web build. Independent review checks invalidation, transaction correctness and lazy UI behavior.
5. Verify an end-to-end synthetic trip path against local services. Deployments, cloud authentication limitations and any untested browser behavior are reported explicitly.

## Cost, deployment and rollback

No new cloud resources, database capacity changes, periodic keepalives or provisioned concurrency. Aurora remains configured to pause after five idle minutes; this slice reduces warm-request work but does not remove database resume latency. Frontend and core changes are independently deployable and preserve existing contracts. Roll back by deploying the previous web/core build; no data rollback is needed.

## Implementation and local verification

- Optional status, attendees, booking and comment sections start closed and fetch on expansion. Comments use the existing session user. A mounted-planner store shares people/bookings across staggered card opens and invalidates after related writes or access loss.
- Concurrent browser GETs and token refreshes are coalesced. Settled global private responses are discarded. Account transitions abort old refreshes; invalidated GETs may retry once, while mutations are never replayed. Server execution does not share browser refresh/account state.
- Inactive workspace tabs use lazy imports. Search debounce is 300 ms instead of 800 ms, and current results remain visible while the next query loads.
- IAM PostgreSQL operations use one request-scoped connection with serial whole transactions and destructive cleanup in `onSend`, plus response/timeout/abort fallbacks. Acquiring a connection allows 20 seconds; the web proxy allows 30 seconds. Other database operations retain their previous release behavior.

| Check | Result |
| --- | --- |
| Web tests | 26 passed, including GET/refresh coalescing, account and mutation invalidation, private server isolation and shared-list request counts. |
| Web typecheck and final production build | Passed on the final source. |
| Core typecheck and production build | Passed. |
| Core request-connection lifecycle tests | 10 passed; independently rerun by the verifier. Real Fastify lifecycle with a controlled pool covers isolation, transaction ordering, rollback, acquisition failures, disconnects and cleanup before response. |
| Full core suite | Initial run: 119/121 passed; stays/travel aborted during PGlite WebAssembly startup. Both affected suites passed a targeted serial rerun, 8/8, without code changes. |
| Local performance-path HTTP regression | `node scripts/verify-performance.mjs`: all 6 groups passed through the web proxy. Covers five activities, parallel detail reads, saves/reloads, failed edits, outsiders, removed members and signed-out readers. Synthetic trip cleaned up. |
| Existing local planner and splits HTTP suites | `npm run verify:planner` and `npm run verify:splits`: 8 groups passed in each. Exact money, repayments, manual itinerary changes and private access boundaries remain correct. |
| AWS deployment packages | Built; `node infra/scripts/verify.mjs --packages` passed, including bundled handlers initialized with production restrictions and no database connection. |
| Independent source review | Passed after fixing two identified races: old token refresh after account change and unrelated read failures during writes. |

The local trip-page manifest's referenced client chunks decreased from 259,672 to 122,964 raw bytes, or 71,276 to 39,445 gzip bytes (approximately 45% gzip reduction). This excludes framework/runtime chunks outside that manifest list and is not a measurement of a complete browser page transfer.

The per-activity eager-request reduction is established by the lazy effect guards and focused list/client tests; actual browser network counts and phone rendering remain unverified. Native browser inspection was previously blocked by URL verification, and this session's in-app browser could not attach to its webview. HTTP regression does not replace rendered UI acceptance.

## Delivery status

The implementation is committed as `b0dbde2116c40216b62ff2eb5fc10e9e58ffdda4` on `codex/trip-loading-performance` and pushed to the [Goa repository](https://github.com/DushyantBhardwaj2/GoaIntenary/tree/codex/trip-loading-performance). [GitHub Actions run 41011699471](https://github.com/DushyantBhardwaj2/GoaIntenary/actions/runs/41011699471) passed all three jobs: verify, discovery and infrastructure. Vercel reports a successful [branch preview](https://goa-intenary-git-codex-trip-loading-performance-dushyant2.vercel.app). Preview page/API checks redirect to Vercel Authentication; protection was not disabled.

Cloud deployment and live latency verification are pending. AWS connection checks require the owner's sign-in; the owner selected “I'll sign in” but a completed sign-in has not been confirmed. The Vercel connector cannot access this project's workspace, so build status was verified through the public GitHub integration. The connected GitHub integration could not create a draft PR (403); Git CLI branch delivery succeeded.

Automatic approval review rejected a push of this branch to `main`, stating that the user had authorised implementation/preview but not production promotion while backend cloud verification is outstanding. That rejection was not bypassed. The existing production website and AWS runtime have not been updated by this slice. Explicit release approval and AWS sign-in are the remaining prerequisites. Once authorised, deploy the packaged core through the existing runtime procedure, apply only any previously approved required migrations, run the cloud smoke checks, and release/verify the web build. No new resources or capacity changes are needed.
