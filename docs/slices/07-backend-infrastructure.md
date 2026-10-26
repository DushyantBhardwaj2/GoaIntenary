# AWS development backend connection

Scope: infrastructure, backend deployment, real PostgreSQL connectivity, and operating checks only. Cursor continues to own product features. No production release or public signup is authorized by this slice.

Input: the owner's AWS browser session, the Mumbai region, and a development-only configuration. Output: independently deployed TypeScript core and Python discovery APIs, Cognito configuration, and a migrated PostgreSQL database. The core remains the owner of private tables; Python remains public-only.

Permissions: no synthetic local authentication in AWS; the core uses a dedicated SQL role with DML access, migrations use a separate owner role, and both use short-lived IAM database tokens plus verified TLS. Deployment uses a project role with a permissions boundary on the Lambda roles. User passwords and AWS credentials must never enter Git or output logs.

Acceptance: real PostgreSQL migrations, core and discovery health, a signed-in test identity creating and reopening a trip, outsider denial, and persistence across Lambda environments. This does not verify a Vercel preview or production readiness.

Account check (21 October 2026): temporary CLI browser session established; Free Plan independently verified with US$100 remaining and expiry 21 April 2027. No pre-existing Mumbai Cognito pool, PostgreSQL/Aurora cluster, or Goa stack was found. The budget recipient was supplied by the owner and is kept out of committed configuration.

Deployed: Aurora PostgreSQL Express 17.9, min 0 / max 1 ACU, IAM-only managed gateway, 300-second idle pause, one-day backups and deletion protection; no NAT, DB password, RDS Proxy or Data API adapter. CDK owns a retained custom resource with the bundled RDS SDK because the native CloudFormation DBCluster does not expose Express. The provider never deletes the database. The project database is created afterward through SQL because Express rejects an initial database name in its create request.

Failure: configuration/auth/database failures must fail closed, with no credential details logged. Live database/engine/account limitations must be recorded rather than worked around by upgrading the plan or weakening TLS. Public signup stays disabled until the owner chooses to enable it.

Verification completed: core TypeScript and all **63 tests** pass; Python **51 tests** pass; infrastructure typecheck/synthesis/security assertions and package initialization pass. The migration-history test derives expected versions from `latestMigration`, accommodating Cursor's migration 4. A live Cognito identifier-format failure was corrected: PostgreSQL-compatible UUID text is accepted without RFC variant-bit restrictions, while JWT signature/issuer/client/expiry and membership authorization remain enforced. The new provider-subject regression test passes.

The owner authorized **US$10 monthly usage alerts**, replacing US$25. Saved thresholds, credit exclusion and recipient were verified. Both stacks are UPDATE_COMPLETE. All eight live backend groups pass, including real Cognito accounts, private-trip idempotency/invitation, outsider/removed-member denial and PostgreSQL persistence in published Lambda version 1. Runtime SQL privileges and migrations 1–4 were verified directly. Temporary test accounts were deleted and the synthetic trip soft-deleted. See [live evidence](../verification/07-aws-backend.md). Vercel/browser, restore, observed idle pause/resume and production acceptance remain open.

Costs and cleanup are documented in [infra/README.md](../../infra/README.md). Light development is an assumption scenario around US$11–16/month before tax/credits; continuous activity can exceed the alert threshold. No paid plan transition, production release, domain change, public signup or product feature was made by this infrastructure slice.
