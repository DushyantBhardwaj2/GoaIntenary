# Slice 01: a private trip and its invited members

Implementation started 21 October 2026. Stage 0 cloud gates remain mandatory before provisioning. This slice implements the private-trip portion of Stage 1 in the latest user request, bringing the former Stage 2 membership work forward. Discovery is a later slice.

## Outcome and acceptance

A signed-in organiser creates a named trip with valid dates, generates a revocable invitation, and approves a second account's request. The second account can reopen the saved trip. A third account with its URL receives the same not-found response as an unknown trip. Removing the second account blocks its next read. Repeated acceptance cannot duplicate membership. Invites require approval by default.

Core owns profiles, trips, membership, invitation hashes, and safe audit records. PostgreSQL constraints and transactions enforce writes. Local development may use file-backed PGlite (embedded PostgreSQL), explicitly labelled as local; deployed services must use an AWS PostgreSQL connection. No password database is permitted.

## Authentication boundary

Web is a Next.js backend for frontend (BFF): HTTP-only SameSite=Lax session cookies, exact same-origin checks on mutations, and server-to-core Bearer authentication. Cognito email/password registration, confirmation, login, forgot/reset, and logout are the real account integration, activated only with actual pool/client configuration. Core verifies Cognito access tokens against pool/client before resolving the profile.

While account access is unavailable, an explicitly enabled **loopback-only synthetic account mode** may exercise private-trip behavior. It is never presented as Cognito registration and must fail closed on production/AWS or missing signing secret. The launcher creates a fresh shared random secret per run; do not commit it. Tokens are `local.<base64url JSON>.<base64url HMAC-SHA256 of local.payload>`, with JSON `{sub,email,displayName,exp}` and an expiry in epoch seconds. Core and web require `ENABLE_LOCAL_DEMO=true`, `NODE_ENV != production`; core additionally rejects local mode on Lambda. Local web entry points accept only localhost/127.0.0.1 hosts. Accounts: Aman `10000000-0000-4000-8000-000000000001`, Riya `10000000-0000-4000-8000-000000000002`, outsider Dev `10000000-0000-4000-8000-000000000003`, emails `{aman,riya,dev}@example.invalid`. Tokens, passwords, invite tokens, and cookies must not appear in logs.

Pilot limitation: removed membership rows cannot be restored through any invitation, including a newly generated one. An explicit organiser restoration action is a later feature; removal preserves history. Email account change-password/deletion/resend-verification and additional Cognito challenges are not yet implemented. Real Cognito verification/reset/email delivery remains untested until account setup is available.

## HTTP contract v1

JSON requests and responses; authenticated core routes use `Authorization: Bearer ...`. IDs are UUIDs. Dates are real calendar dates `YYYY-MM-DD`, timestamps UTC ISO. No author or role comes from request bodies. Bodies reject unknown properties. Error: `{error:{code,message}}`, codes `UNAUTHENTICATED`, `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`, `CONFLICT`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`. Private non-member reads/writes return generic 404. Member actions requiring organiser return 403. No caching of private responses.

- `GET /health` → `{status:"ok",authMode:"local"|"cognito",storage:"pglite"|"postgres"}`.
- `GET /v1/me` → `{user: User}`.
- `GET /v1/trips` → `{trips: Trip[]}`: only accepted memberships.
- `POST /v1/trips` body `{name,startDate,endDate,description?}` → 201 `{trip:Trip}`; creator becomes organiser atomically. Honor `Idempotency-Key` UUID for retry-safe creation.
- `GET /v1/trips/:tripId` → `{trip:Trip,members:Member[],invitations:Invitation[]}`; only organiser sees pending members/invites, members see accepted people and empty invites.
- `POST /v1/trips/:tripId/invitations` body `{requiresApproval?:boolean}` (default true) → 201 `{invitation: Invitation & {token:string}}`. Cryptographic 32-byte random token, hash only at rest, seven-day expiry; organiser only. Raw token returned once and kept only in UI memory. Invitation list never returns token/hash. Duplicate clicks disabled in client, server rate-limited.
- `DELETE /v1/trips/:tripId/invitations/:invitationId` → 204, idempotent revocation, organiser only.
- `POST /v1/invitations/accept` body `{token}` → `{tripId,status:"pending"|"accepted"}`. Invalid/expired/revoked invite → generic 404. Existing accepted member remains accepted; removed members cannot rejoin through an old invitation. Duplicate acceptance is idempotent. Pending people cannot read trip content.
- `POST /v1/trips/:tripId/members/:userId/approve` → `{member:Member}`; organiser only, idempotent.
- `DELETE /v1/trips/:tripId/members/:userId` → 204; organiser only, cannot remove organiser, preserve row/history, repeat safe.

`User={id:string,displayName:string,email:string|null}`.
`Trip={id,name,startDate,endDate,description:string,createdAt:string,role:"organiser"|"member"}`.
`Member={userId,displayName,role:"organiser"|"member",status:"accepted"|"pending"|"removed"}`.
`Invitation={id,expiresAt:string,revoked:boolean,requiresApproval:boolean,createdAt:string}`.

## Failure states and verification

Keep form input after failed saves. Missing account configuration must explain setup is pending. The page must show that synthetic accounts are a local test environment. No map, money, file, or itinerary feature may pretend to work. Verify persisted state after API restart, organiser-only actions, unauthenticated/outsider/removed/pending access, expiry/revocation, duplicate acceptance, malformed dates, and CSRF origin checks. Cloud account/email delivery, Vercel/AWS end-to-end, and real Cognito multi-account tests stay Not tested until available.
