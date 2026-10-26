# Slice 01 handoff — 21 October 2026

## Working result

The local website creates persistent private trips and supports invitation links, approval requests, organiser approval, revocation, and member removal. The Fastify API enforces membership; the browser does not grant itself access. File-backed PGlite uses the same versioned SQL schema and transactional repository as the separate PostgreSQL adapter. Cognito integration code supports registration, email confirmation, login, password reset, refresh, and sign-out, but has not been exercised against an actual pool.

Run `npm run dev:local`, then open <http://127.0.0.1:3000>. The running preview is local, with clearly labelled synthetic Aman/Riya/Dev accounts. The owner confirmed that the preview loads and requested changes; the particular screen/desired change is awaiting clarification. Automated verification created labelled synthetic trips in the local database. They are test fixtures, not trips created by real accounts.

## Contributions and integration

- Coordinator: initial inspection and shared [HTTP/security contract](01-private-trips.md), root workspace/lock, launcher, environment example, CI, 12-check live BFF test, source review, integration, and product/status alignment.
- Core creator subagent: `services/core-api/`, PostgreSQL/PGlite adapters, migration, Cognito identity verification, transactional domain operations, safe logging, rate limits, Lambda entry, and tests. Follow-up hardens deployed TLS against URL overrides.
- Website creator subagent: `apps/web/`, responsive coastal interface, cookie-based Cognito adapter, same-origin bounded BFF, error states, stable trip retry keys, and native member-removal dialog.
- Platform subagent: Stage 0 account evidence, official regional pricing snapshot/reproduction script, cost scenarios, Free Plan restrictions, and hosting proposal.
- Independent verifier (platform specialist rotated after its handoff; did not author web/core): reran tests and live HTTP checks, supplemented malformed/concurrent/access tests, and wrote [verification evidence](../verification/01-private-trips.md).

No user-owned sidebar chats were created. Python discovery is intentionally deferred to the catalogue outcome; no empty service is counted as delivered functionality.

## Actual checks

- Root `npm run typecheck`: Pass, including Next route type generation after the fresh-checkout script update.
- Web security tests: 4 Pass.
- Core tests: 15 Pass after TLS hardening, including 12 nested private-trip/database cases, synthetic auth/config, and deployed TLS validation. Uses real embedded PostgreSQL, not RDS.
- Root `npm run build`: Pass for Next.js 16.4.2 and core; core build also passed after its production-only TLS follow-up.
- `npm run verify:local`: 12 Pass through the running Next BFF, HTTP-only cookies, API, and persisted database; independently rerun.
- `node scripts/independent-verify.mjs`: 7 supplemental groups Pass: request origin/Host, account-name validation, declared/chunked byte bounds, malformed inputs, retry conflict/concurrency, membership authority, removal/revocation.
- Source review: no application `console` logging of credentials, browser local/session storage, or public secret environment variables in web/core source. Browser runtime storage and rendered states remain untested.
- Browser inspection: Not tested. Subagent lacked browser access; coordinator acquisition was then rejected by browser security policy. No alternate browser or policy workaround was attempted. Owner confirmation that the page loads is availability evidence only.
- Real Cognito delivery/multi-account flows, deployed PostgreSQL networking, AWS Lambda/API Gateway, Vercel preview, phone layout and keyboard journey: Not tested.

The independent [acceptance matrix](../verification/01-private-trips.md) is the detailed source for test provenance and limitations. A local pass does not close cloud Stage 1 acceptance.

## Costs and remaining gates

No AWS resource, budget alert, account upgrade, deployment, tile subscription, or production signup was created. Incremental provisioned cloud cost from this slice is zero; existing account/vendor costs were not audited. The latest billing fact is owner-reported US$100 remaining on AWS Free Plan, replacing the old US$450 estimate. Exact expiry, eligible account configuration, operational access and actual budget/notification setup remain open.

The [Stage 0 report](../stage-0.md) and [hosting proposal](../decisions/2026-10-21-hosting.md) compare Mumbai RDS/Aurora, list Free Plan restrictions, propose a US$25 gross-usage monthly ceiling, and track Vercel/map costs separately. No proposal is a provisioned resource or an independently verified credit balance.

Next: apply the owner's concrete preview feedback. For cloud completion, establish authenticated development AWS access and the account's Free Plan end/credit expiry, verify allowed services/configurations, configure the budget recipient/alerts, and finish CDK development infrastructure plus a Vercel-to-AWS Cognito multi-account preview. Discovery follows that acceptance gate.

## Known slice limits

Removed members cannot rejoin with any invitation until an explicit restoration flow is implemented. The web adapter supports non-rotating Cognito refresh tokens and does not implement MFA/custom challenges, resend verification, change password or account deletion. The auth attempt limiter is process-local and must be made suitable for public hosted use. There is no deployed CDK stack or public preview. Phone typography was reviewed and enlarged in source; no rendered mobile usability pass is claimed.
