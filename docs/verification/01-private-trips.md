# Independent verification: private trips / Slice 01

Date: 21 October 2026. Verifier did not author web/core feature code. Scope: [slice contract](../slices/01-private-trips.md), local synthetic accounts and file-backed embedded PostgreSQL. Coordinator owns release acceptance.

**Local API/BFF and automated checks passed. The owner confirmed the preview loads and requested changes. Rendered mobile/keyboard and cloud checks remain Not tested. Stages 0/1 remain open.**

## Executed evidence

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | Pass | Independently executed both workspaces; exit 0. |
| `npm test` | Pass | Independently executed: web 4/4 and initial core 14/14 reported tests passed; exit 0. |
| Final core suite including deployed TLS guard | Pass | Independent `npm test --workspace @goa/core-api`: 15/15 passed after final guard changes, exit 0. |
| `npm run build` | Pass (coordinator evidence) | Coordinator reported clean Next 16.4.2 web build with `/`, `/join`, `/trips/[tripId]` and core TypeScript build. After production-only TLS changes, core author reported its build/typecheck passed. Latest web next typegen/typecheck also passed per coordinator. Verifier's overlapping build attempt exited on existing Next build lock and was not rerun. |
| `node scripts/verify-local.mjs` | Pass | Independently executed against final restarted `http://127.0.0.1:3000`; all 12 integrated groups passed, exit 0. |
| `node scripts/independent-verify.mjs` | Pass | Independently executed against the same server; all 7 supplemental groups passed, exit 0. Oversize probes were bounded to approximately 10/20 KB. |

Live HTTP checks traversed the actual Next BFF and running core with distinct Aman, Riya and Dev synthetic sessions. Scripts create real synthetic local records; they do not inject fake API responses or use cloud accounts. No tokens, cookies or invitation secrets are printed.

The supplemental harness initially tried a forged Host with fetch, whose normalization did not exercise the intended header. The harness now uses node:http to transmit an explicit forged Host. The real check returned 401 and the entire rerun passed. This was a corrected harness assumption, not a feature bypass.

## Acceptance matrix

Pass results are scoped to the stated local, automated or source-review evidence.

| Acceptance rule | Status | Evidence / limit |
| --- | --- | --- |
| Explicit synthetic mode, distinct identities, loopback gate | Pass | Status showed explicit local mode; three logins resolved distinct identities. Core tests rejected expired/altered signatures, fixture mismatch, unsafe production/Lambda config and non-loopback sources. Raw forged Host with forwarded loopback host returned 401. No deployed proxy test. |
| Session cookies, unauthenticated denial, logout | Pass | Actual Set-Cookie contained HttpOnly/SameSite=Lax; unauthenticated trips returned 401; logout expired access cookie. Local HTTP cookies intentionally lack Secure; production behavior is not deployed. |
| Exact same-origin mutations | Pass | Unrelated, empty, null, wrong-port and trailing-slash Origin cases returned 403. Valid local origin succeeded; forwarded-host substitution did not grant access. |
| Enumerated synthetic account names | Pass | `__proto__`, `constructor`, `toString` and an unlisted name each returned 400. |
| Private atomic trip creation | Pass | Aman created a real trip/organiser membership. Database tests checked uniqueness, date constraints and deliberate rollback. |
| Retried trip creation | Pass (API) | Same key/body returned same trip; changed body/key reuse returned 409. Core tested concurrent creation. UI stable retry key is source-reviewed; ambiguous browser-save failure is untested. |
| Default approval and pending denial | Pass | Omitted approval option returned true. Three concurrent Riya accepts returned pending and left one membership. Pending read and invitation write returned 404. |
| Organiser-only management | Pass | Aman approval succeeded; accepted Riya read succeeded. Member management returned 403, pending/outsider actions 404; organiser removal returned 409 in core tests. |
| Member view and invitation secrecy | Pass | Member detail exposed accepted people and empty invitations. Lists omitted tokens; database tests checked SHA-256 hash storage and omitted token/hash in detail responses. |
| Outsider cannot distinguish private and absent trip | Pass | Dev received 404 and identical JSON bodies for existing private and random absent UUIDs; unrelated trip lists remained private. |
| Removal effective next request | Pass | Riya's next read returned 404; list excluded trip; old invitation could not rejoin. Tests preserved removed row/history and a single removal audit entry. |
| Repeat-safe/concurrent operations | Pass | Concurrent accepts left one member; repeated approve/remove/revoke stayed safe. Deployed multi-instance PostgreSQL contention remains untested. |
| Revoked and expired invitations | Pass | Live revoked invite returned 404. Core suite timestamp-adjusted a synthetic expired invite and checked expired/revoked/unknown safe responses. No elapsed seven-day test. |
| Input and streamed body bounds | Pass | Malformed JSON, injected authority fields, coercion, invalid IDs and impossible/reversed dates rejected. Declared and chunked oversized auth/core BFF payloads returned 413. Empty POST approval succeeded through real BFF. |
| Persistence through API/database restart | Pass (embedded PostgreSQL) | Independent suite closed app/database, reopened same file store and checked saved trip/invites plus removed-member denial. Repeated integrated reads worked. Browser refresh and deployed RDS restart remain untested. |
| Deployed database verified-TLS guard | Pass (unit/source) | Final independent suite rejected disabled TLS/insecure URL flags and checked retained strict verification. Source strips URL options that could replace pg TLS configuration and uses rejectUnauthorized=true. No real RDS certificate/network handshake was tested. |
| Safe logging/storage design | Pass (source review only) | Core route-template/status logs, omitted Error/SQL parameters, auth/cookie redaction, no password table, hash-only invites. Web uses component memory and URL fragments, immediately clears invite fragment, and has no localStorage/sessionStorage calls. Runtime audit is separate below. |
| Phone rendering/readability/touch controls | Not tested | Browser policy blocked local page access. Source mobile overrides use 14 px body, 16 px ordinary inputs and largely 44-46 px controls. Actual narrow-screen overflow, contrast, zoom and layout remain untested. |
| Keyboard, focus and removal dialog | Not tested | Source uses native showModal, labelled dialog, initial Keep member focus and cancellation/busy protection. Actual tab order, focus containment, Escape and assistive technology were not exercised. |
| Empty/loading/error UI, failed-save preservation, refresh | Not tested | States/forms were source-reviewed; actual rendered behavior and browser refresh were not exercised. |
| Preview manual availability | Owner-confirmed | Owner replied: “It loads, but needs changes.” Availability only; visual/behavior details and revision review are pending. No inferred usability/mobile pass. |
| Runtime logs/browser storage free of secrets | Not tested | Source and test stdout reviewed; no complete runtime-log or browser-storage inspection. |
| Real Cognito register/verify/login/reset/logout and delivery | Not tested | No configured cloud identity/account access. Synthetic login is not Cognito evidence. |
| RDS wire/TLS/network/IAM/backup/restore | Not tested | Embedded PostgreSQL does not verify actual AWS database/network/certificate/secret/failover behavior. |
| Vercel preview to development AWS journey | Not tested | No deployment created; actual credit expiry, service eligibility and budget/alerts remain open Stage 0 gates. |

## Findings fixed and retested

Header-only body limits were identified by coordinator and verifier. Creator implemented streamed byte caps; declared/chunked probes now return 413. Inherited-property account selection was replaced with an own-property check; inherited-name probes return 400.

Verifier identified unconditional upstream JSON Content-Type on empty approval POSTs. Creator now omits it when no body exists; actual BFF approval succeeds. Stable UI retry keys and native modal are source-reviewed; browser behavior remains untested. Core deployed-TLS hardening was independently unit-tested after its final handoff.

No unresolved feature failure was reproduced within executed local HTTP/database checks. Untested visual/cloud items remain required before accepting those broader stages.

## Browser blocker and next verification

Verifier CUA returned `Browser is not available` for both in-app alias and coordinator-supplied browser/tab IDs. Coordinator then attempted the real local page from root CUA and reported a security-policy denial because the requested HTTP URL protocol was not allowed. No further browser attempts or alternate browser workaround was used. No screenshot, phone, keyboard, rendered error-state or browser-refresh pass is claimed.

When permitted browser preview access exists, run Aman create/invite, Riya request, Aman approve, Riya reopen, Dev denial, Aman remove and Riya denied. Check phone widths, keyboard, refresh, failure states and failed-save preservation. Owner-requested changes need details and a fresh visual review. Keep real Cognito/AWS/Vercel acceptance separate until those environments exist.

## Reproduction

Against the already running explicit local review server:

```powershell
npm run typecheck
npm test
node scripts/verify-local.mjs
node scripts/independent-verify.mjs
```

Run a single `npm run build` when another build is not holding the Next lock. Local scripts are restricted to HTTP localhost/127.0.0.1 and must not be pointed at cloud accounts. Do not delete another process's build lock or start conflicting servers.
