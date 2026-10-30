# Goa private-trip core API

This service implements [private trips](../../docs/slices/01-private-trips.md), the [manual planner and budget](../../docs/slices/02-premium-planner.md) and [selected-traveller splits](../../docs/slices/03-map-and-splits.md). It owns profiles, trips, memberships, invitation hashes, activities, saved snapshots, expenses, stored shares, guests, balances, repayments, retry keys, audit entries and rate limits. Budget averages remain planning values; the separate ledger derives exact balances from allocated shares and repayments. Public discovery remains a Python service; bookings and documents are later work.

From the repository root, use `npm run dev:local` for the coordinated local environment. The launcher generates a shared signing secret, binds the API to loopback, and uses file-backed PGlite under ignored `.data/core`. Local accounts are explicitly synthetic: Aman, Riya, and Dev at `example.invalid`. They do not create Cognito users or store passwords.

Individual workspace commands:

```text
npm run dev --workspace @goa/core-api
npm run build --workspace @goa/core-api
npm run typecheck --workspace @goa/core-api
npm test --workspace @goa/core-api
npm run db:migrate --workspace @goa/core-api
```

The build emits `dist/server.js` and `dist/lambda.js`. The Lambda handler is `dist/lambda.handler`; package the `migrations/` directory beside `dist/` for the separate migration command. Runtime Lambda does not run migrations. No cloud resources are created by these scripts.

AWS development packaging and deployment are in [infra/README.md](../../infra/README.md). `dist/migration-lambda.handler` is invoked explicitly with a separate migration SQL role. For Aurora Express, set `DATABASE_IAM_AUTH=true` and `DATABASE_REGION`, and use a passwordless `DATABASE_URL` identifying the SQL role. The API generates a fresh IAM token for each new connection. Within each HTTP request it lazily acquires one connection, reuses it for admission/profile/route work, and destroys it before sending the response, including error responses. Timeout and aborted-request cleanup are also registered. Concurrent requests never share a checked-out connection; complete transactions and standalone operations within one request are serialized. Work outside an HTTP request, including migrations, retains close-per-operation behavior so idle clusters can pause. IAM connection acquisition allows twenty seconds for database resume and never retries writes. Verified TLS remains mandatory. Password-authenticated PostgreSQL and local PGlite retain their existing paths.

Cognito subjects use the provider's UUID-shaped format, which can have non-RFC variant bits. Identifier validation accepts canonical PostgreSQL UUID text without imposing RFC version/variant requirements; it never replaces JWT signature, issuer, client, expiry or membership checks. This is covered by the deployed multi-account smoke check and `test/cognito-subject.test.ts`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `ENABLE_LOCAL_DEMO` | Set exactly `true` only for explicit synthetic local accounts. |
| `LOCAL_SESSION_SECRET` | Shared random signing secret, at least 32 bytes; never commit it. |
| `PGLITE_DATA_DIR` | Local persistent PostgreSQL directory; defaults to repository `.data/core`. |
| `HOST`, `PORT` | Development listener; default `127.0.0.1:4000`. Non-loopback development listeners are rejected. |
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | Required when synthetic accounts are disabled. Core verifies Cognito access JWT signatures, issuer, token use, client, and expiry. |
| `COGNITO_REGION` | Cognito region; defaults to AWS region or the pool prefix. |
| `DATABASE_URL` | PostgreSQL connection string. Required on production/Lambda. |
| `DATABASE_TLS` | Certificate-verified TLS is mandatory for production/Lambda; `false` is rejected. Local PostgreSQL can disable it explicitly. |
| `NODE_EXTRA_CA_CERTS` | Path to a trusted CA PEM bundle, supplied before Node starts; configure the current AWS RDS CA bundle when the default trust store does not trust the database certificate. |

Synthetic authentication is rejected under `NODE_ENV=production`, on Lambda, without an adequate secret, for a non-loopback socket, and for any identity outside the three signed fixtures. `X-Forwarded-For` is not trusted. The API and web must share the current launcher secret; restarting the launcher invalidates old synthetic sessions.

Deployed database URLs reject insecure TLS modes and certificate-verification overrides. The service removes URL SSL options before passing the URL to pg, then supplies `ssl: { rejectUnauthorized: true }` explicitly, so pg's URL parser cannot overwrite verification. `sslmode=require` and `verify-full` are accepted and both use certificate plus hostname verification. URL certificate paths are removed too; use the trusted CA bundle through `NODE_EXTRA_CA_CERTS`. An untrusted/self-signed server certificate fails verification unless its trusted issuing CA is configured; verification is never switched off as a workaround.

Cognito profile attributes come from token-authorized `GetUser` after JWT verification. This operation does not require IAM credentials. If an otherwise verified access token lacks the GetUser scope or profile lookup is temporarily unavailable, an existing profile is preserved; a new profile uses `Traveller` and no email. A GetUser rejection for revoked/unknown users is denied. Live Cognito testing requires a real pool/client and remains unverified locally.

## Persistence and migration

`001_private_trips.sql` is an additive initial migration, with no existing-row backfill or cross-service writes. All tables use the `goa_core_` prefix. SQL enforces trip date order, membership uniqueness and state consistency, a single accepted organiser, unique invitation hashes, one acceptance per invitation/account, and per-account retry-key uniqueness. An append-only trigger protects audit history. Audit rows contain only actor, trip, target IDs, an action, and time; invitation secrets and personal text are absent.

Migrations run transactionally under a PostgreSQL advisory lock and are recorded in `goa_core_migrations`. Local startup applies them automatically. For a deployed database, run the migration command with the migration role before starting the new API. A runtime DB role should have only the required table read/write permissions, no schema DDL, and no ability to replace the audit trigger. The forward strategy is another additive migration; rollback this first release by rolling back the app while preserving tables. Drop tables only in a disposable local directory or under a separately reviewed, backed-up production procedure.

`002_premium_planner.sql` upgrades existing databases without replacing records. Trips receive compatible defaults: region `all`, planned traveller count `1`, no budget, and no styles. It adds activity, saved-place, paid-expense/history, and scoped retry-key tables; extends audit action kinds; and adds soft-deletion state. No dates or old trip values are rewritten. New/edited trips are limited to 366 days between start and end. Existing activities block narrowing dates beyond their scheduled days. Migration tests insert a v1 trip/member/invitation, apply 002 twice, and verify the original records plus defaults. Roll back application code while retaining the additive schema, or ship a forward correction; never clear `.data/core` to apply this upgrade.

Each pg transaction uses one checked-out connection. PGlite serializes complete transactions and standalone operations. Run only one local API process for a PGlite directory; it is a development store, not shared production storage. Tests create isolated directories under ignored `.data/tests`, because this Windows sandbox's temporary mount rejects WAL renames. Restart persistence is covered; power-loss durability and backups are not established by that test.

Creation, invitation acceptance/revocation, approval, removal, and their audit writes are transactional. Trip creation honors an optional UUID `Idempotency-Key`; a repeated key with different normalized input returns conflict. Invitation hashes expire after seven days. Acceptance and approval are repeat-safe. Removal preserves membership/audit history and blocks future reads immediately. For this pilot, a removed account cannot rejoin through any invitation; a future reinstatement flow must be an explicit organiser action.

## Manual planning and budget

The organiser can PATCH trip settings or DELETE the trip. Deletion retains historical rows, hides all old and new resources/invitations, and is repeat-safe for the organiser. Accepted members can create/edit/delete shared activities, explicitly save a public place snapshot, or record spending. Activity editing requires its current `version`; stale forms return conflict. Reordering supplies the exact current IDs for one day (or null for unscheduled), preserves time labels, increments versions, and returns that day's ordered activities. Dates and times never cause automatic scheduling or reordering. Changing a day appends to the new day's manual order. Activity and trip deletes preserve audit rows.

Saved places contain bounded, untrusted source snapshots; only HTTP(S) source URLs are accepted and the API never fetches them. A duplicate save preserves the existing snapshot. Saving does not schedule anything. Explicit activity creation can copy the place ID, location and coordinates while keeping independent notes and estimates. Removing a saved snapshot does not modify an activity.

Expenses record one payer and a positive integer amount in paise. New payer/share selections must be active trip expense participants: accepted members or organiser-created guests. The creator or organiser can correct/delete records; version checks prevent stale updates. Each expense version has append-only actor/value/share history. Removing a member or archiving a guest retains their historical payer and shares but blocks new assignments. Guests grant no account or membership rights.

`003_selected_expense_splits.sql` preserves existing expense IDs/amounts and leaves them explicitly unallocated (`split_mode=none`). It adds trip-scoped participant, share and repayment tables; extends history/audit/retry kinds; and backfills member payer references without rewriting append-only history. Equal splits distribute remainder paise in sorted participant-ID order. Custom shares must sum exactly; deferred database triggers independently enforce totals and composite foreign keys enforce trip scope. Expense/share/audit writes are atomic. Old `paidByUserId` clients remain supported by the new API, including their saved retry hashes. New clients use `paidByParticipantId`, since a guest has no user ID.

New routes are GET/POST `expense-participants`, DELETE `expense-participants/:participantId` (guest archive, organiser-only), GET `ledger`, POST `repayments` and DELETE `repayments/:repaymentId`, under the private trip prefix. A member may record their own outgoing repayment; the organiser may record guest/historical payments. Repayments must fit outstanding balances, are retry-safe, and never count as spending. The ledger uses paid minus shares plus repayments sent minus repayments received, with a checked zero-sum result. Suggestions do not write payments. After repayments, expense correction/deletion requires an organiser's explicit `acknowledgeSettlementChange`; no repayment is erased.

Migration 003 requires the updated API: a v2 binary does not understand guest payers or the new required participant references. Prefer a forward correction. Before any deployed rollback, stop writes and restore a reviewed consistent backup or ship a compatibility release; do not blindly roll back to v2 after guest/split writes. Local `.data/core` was backed up before applying 003 and never cleared. File-store close/reopen, v2 migration/retry compatibility, share constraints, subgroup/custom/rounding, removed participants, repayment corrections and access rules are covered by `test/ledger.test.ts`.

`GET /v1/trips/:tripId/budget` is authoritative: planned totals sum active activity estimates, actual totals sum active paid records, and remaining is budget minus actual only. With a ₹20,000 budget, ₹8,000 planned and ₹1,250 recorded, remaining is ₹18,750. Approximate per-person values use declared planned travellers and round half up to a paise with integer/BigInt arithmetic. They never describe debt. Category totals map beach/culture/adventure/nightlife to activities, cafe/food to food, shopping and transport directly, and other to other. Expense amounts and individual estimates cap at 1,000,000,000 paise; totals reject unsafe integer overflow.

The new routes are trip PATCH/DELETE, activity GET/POST/PATCH/DELETE plus POST `activities/reorder`, saved-place GET/POST/DELETE, budget GET, and expense POST/PATCH/DELETE under `/v1/trips/:tripId`. Activity/expense creation honors optional UUID `Idempotency-Key` values scoped to actor, trip and resource kind. Actor, creator, role, IDs, display names and sort order are server-owned. Full request/response shapes are in the slice contract.

## Reel and photo ideas

[Slice 08](../../docs/slices/08-reel-ideas.md) adds shared trip inspiration under GET/POST `/v1/trips/:tripId/reel-ideas` and PATCH/DELETE `/v1/trips/:tripId/reel-ideas/:ideaId`. Each idea stores a title, reel/photo kind, optional HTTPS Instagram reference, place, notes and one or more accepted member IDs. All accepted members can read ideas; the creator or organiser can edit/remove them. A removed member cannot access ideas, but their original selected-person reference stays visible to the remaining group until edited.

Migration `005_reel_ideas.sql` adds idea/selected-person tables and extends the existing retry/audit constraints. Existing rows need no backfill. Apply the migration before deploying the new API; the runtime does not migrate cloud databases. A code rollback may leave the additive tables intact. Creates accept a UUID `Idempotency-Key`; PATCH requires the full idea input and current integer `version`, returning 409 for stale writes. Authorised DELETE retries return 204 without duplicating audit history. `test/reel-ideas.test.ts` checks private access, URL safety, invalid people, rollback/retry, concurrent edits, deletion, migration compatibility and fresh-connection persistence. No Instagram requests, embeds, credentials or new cloud resources are introduced. Fastify's [schema validation reference](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) was checked on 26 October 2026.

## Security and checks

Private responses use `Cache-Control: no-store`. Outsiders and pending/removed members receive generic 404s, matching unknown trips. Accepted members receive 403 for organiser-only operations. Bodies reject extra properties and type coercion; dates are real calendar dates and paths are UUIDs. The logger emits request ID, method, route template, status, and timing, never raw URLs, headers, tokens, cookies, request bodies, SQL errors, or connection details. Errors return stable codes with safe text.

Minute counters in PostgreSQL rate-limit sensitive actions across API instances. The socket-IP admission limit currently aggregates callers behind a BFF or API Gateway; account limits apply after authentication. Configure an explicitly verified gateway source-IP strategy and edge abuse controls before a larger deployment. Old counters are pruned hourly. No arbitrary forwarded header is accepted as identity or an IP address.

`GET /health` verifies database connectivity and the latest migration version before reporting auth/storage modes. Tests use Fastify injection and a real file-backed PGlite PostgreSQL engine for authentication boundaries, outsider privacy, pending/accepted/removed membership, repeat-safe actions, expiration/revocation, raw-token exclusion, SQL constraints, rollback, concurrent retries, validation, rate limits, and API/database restart persistence. Planner tests cover additive upgrade, CRUD, exact reorder, stale versions, foreign-trip IDs, soft-delete privacy, source URL validation, exact money, correction history and persisted notes/estimates. AWS PostgreSQL, API Gateway, Lambda, and real Cognito multi-account flows still require development-cloud verification.

Implementation references checked 21 October 2026: [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [Fastify logging](https://fastify.dev/docs/latest/Reference/Server/#logcontroller), [PGlite API](https://pglite.dev/docs/api), [node-postgres transactions](https://node-postgres.com/features/transactions), [node-postgres SSL and URL precedence](https://node-postgres.com/features/ssl), [Cognito JWT verification](https://github.com/awslabs/aws-jwt-verify), [Cognito GetUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GetUser.html), [Fastify Lambda adapter](https://github.com/fastify/aws-lambda-fastify).

Request-connection lifecycle references checked 30 October 2026: [Fastify v5 hooks](https://fastify.dev/docs/latest/Reference/Hooks/) for callback context propagation and response/timeout/abort hooks, and [node-postgres pool](https://node-postgres.com/apis/pool) for connection checkout, transaction ownership and explicit `release(true)` destruction. `test/database-request-scope.test.ts` covers concurrent isolation, transaction serialization/rollback, lazy and failed acquisition, late cleanup and Fastify response/error cleanup. Aurora wake-up and real cloud latency require separate live verification.
