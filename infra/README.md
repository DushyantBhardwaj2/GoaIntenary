# AWS development backend

This folder owns backend deployment only. The web app stays on Vercel; product feature work is separate. AWS CLI credentials stay in the user's AWS credential store. Never put access keys, passwords, tokens, or a real database password in this folder.

Run these from the repository root:

```text
npm run aws:login
npm run aws:doctor
npm ci --prefix infra
npm run synth --prefix infra
npm test --prefix infra
npm run package --prefix infra
node infra/scripts/verify.mjs --packages
```

The local AWS CLI, when available, is in ignored `.tools/aws-cli/Amazon/AWSCLIV2/aws.exe`. Otherwise the scripts use `aws` on PATH or `GOA_AWS_CLI`. `goa-dev` is the temporary browser login. CloudFormation assumes the scoped `goa-dev-deployer` service role for runtime deployment. AWS does not allow a root login to assume an IAM role directly, so there is no separate role-based CLI profile. `aws:doctor` is read-only and masks the account ID.

## Infrastructure ownership

- `goa-dev-foundation`: US$10 monthly usage alerts, private deployment asset bucket, Cognito Lite pool/client, a CloudFormation service role, the Lambda permission boundary, and a scoped Aurora Express provider. The budget is created before other resources. Public signup is disabled. Core/cloud access tests use administrator-created synthetic test identities, without sending email.
- Aurora `goa-dev-postgres`: created through a retained custom resource using the current bundled RDS SDK because CloudFormation does not expose `WithExpressConfiguration`. The cluster is encrypted, uses IAM-only access through Aurora's managed internet gateway, pauses after 300 seconds without connections, and has min 0 / max 1 ACU, **one-day** automated backup retention, and deletion protection. The actual Free Plan API rejected seven-day retention. It also rejected an initial database name in the create request; bootstrap creates `goa` through SQL after the cluster is available. PostgreSQL 17.9 was selected by AWS Express. No customer VPC, NAT gateway, database password, or RDS Proxy is involved.
- `goa-dev-runtime`: independent Node.js 22 core API and Python 3.11 discovery Lambda functions with separate HTTP APIs, plus an IAM-invoked migration function. Runtime logs are retained for seven days. HTTP APIs are throttled; this is not a hard spend cap.

The API SQL role `goa_core` has DML rights only. `goa_migrator` owns the application tables and runs versioned migrations separately. Both obtain short-lived IAM tokens for each new connection and verify TLS. Connections close explicitly after operations so frozen Lambda environments do not keep the database awake. A database resume can make the first request fail or time out; retry after it wakes. No periodic DB health polling should be scheduled because it would defeat idle pause.

The development APIs are live: [core health](https://5f2nwbvfyf.execute-api.ap-south-1.amazonaws.com/health) and [discovery health](https://2k8my0vn19.execute-api.ap-south-1.amazonaws.com/health). Eight live verification groups and 63 core tests pass; see [deployment evidence](../docs/verification/07-aws-backend.md). A real Cognito subject-format mismatch was fixed; JWT verification and private membership checks remain enabled.

## First development setup

Only run provisioning after the owner has reviewed the budget ceiling and the intended account. Do not upgrade the AWS plan automatically. Local configuration is `infra/config/dev.local.json` (ignored); use `dev.example.json` as the non-secret shape. Set `GOA_AWS_ACCOUNT_ID` to pin the intended account, `GOA_BUDGET_EMAIL` to the owner-chosen recipient, and optionally `GOA_MONTHLY_BUDGET_USD` to the reviewed threshold (maximum 25 in this development definition).

```text
node infra/scripts/setup.mjs foundation
node infra/scripts/setup.mjs database
node infra/scripts/bootstrap-database.mjs
node infra/scripts/setup.mjs foundation
npm run package --prefix infra
node infra/scripts/verify.mjs --packages
node infra/scripts/setup.mjs runtime
node infra/scripts/setup.mjs migrate
node infra/scripts/bootstrap-database.mjs --finalize
```

The second foundation pass restricts the Lambda permissions boundary to the actual new database resource ID. The temporary browser session initiates stack operations and uploads artifacts; CloudFormation executes runtime resource changes through `goa-dev-deployer`. Initial SQL-role creation uses the administrator, then object default privileges are configured through `goa_migrator` itself. No administrator managed policy is attached to the deployer or Lambda roles. The Express provider never deletes its protected database. Its seven-day log retention is set explicitly during bootstrap, and old retained provider logs may remain after a failed update. Runtime deployment preserves failed resources for diagnosis rather than automatically rolling them back. Deployment outputs and source/artifact manifests stay ignored. Packaging snapshots the backend sources before bundling so concurrent editor saves cannot mix migration files with another build's code.

`node infra/scripts/smoke.mjs` verifies deployed health, real Cognito authentication, private-trip membership, outsider/removed-member denial, idempotency, and persistence in a separately initialized Lambda version. It removes its synthetic Cognito accounts and soft-deletes its synthetic trip.

For later development code updates, run the relevant checks, then `npm run package --prefix infra`, `node infra/scripts/verify.mjs --packages`, `node infra/scripts/setup.mjs runtime`, and `node infra/scripts/setup.mjs migrate`. Re-run the live smoke check afterward. `node infra/scripts/export-web-env.mjs` refreshes `infra/artifacts/web.env` for a later Vercel preview. Infrastructure policy changes require the separate `foundation` action. This folder does not configure automatic GitHub deployment.

Run `npm run dev:aws` to start only the local website against the deployed backends; this does not run migrations or pass database/AWS credentials to Next.js. `npm run dev:local` remains the synthetic local-development path. Setup does not deploy the website. For Vercel, supply the server environment variables `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `CORE_API_URL`, `DISCOVERY_API_URL`, `APP_ORIGIN`, and `ENABLE_LOCAL_DEMO=false`. Do not expose a database endpoint or AWS credentials as `NEXT_PUBLIC_*` variables. A Vercel preview and browser account-flow checks are still required for cloud stage acceptance.

## Costs, rollback and retention

The account check on 21 October 2026 found the Free Plan with US$100 remaining and expiry on 21 April 2027. This is not a promise of uninterrupted service until that date; credit exhaustion can end it sooner. The budget excludes credits/refunds so credit consumption remains visible. Alerts do not stop usage, and saved subscribers do not prove email delivery.

The same-day verified Mumbai list prices are retained in `pricing/ap-south-1-rds-2026-10-21.json`. At $0.18 per ACU-hour, 60 active hours averaging 0.5–1 ACU cost $5.40–10.80 for compute, before storage/I/O and other services. A provisional $5 reserve puts light intermittent development around $11–16/month before tax/credits. If continuously awake at 1 ACU, compute alone is $131.40 per 730-hour month. These are scenarios, not a cap or a complete bill. Free Plan Aurora storage is limited to 1 GiB. Gateway/transfer details and actual activity must be checked against the account's usage; do not infer any unknown price is zero. The older private RDS micro scenario is about $17.95/month before secure networking and shared services; it is not deployed by this definition.

Rollback runtime code by restoring the previous verified artifact keys from the local deployment manifest and applying only `goa-dev-runtime`. Database migrations require a reviewed forward correction or restored database; changing the Lambda ZIP does not roll schema back. Before any database deletion, export and restore-test needed data, review retained snapshots/backups, then explicitly disable deletion protection and delete through its owning RDS API. Never automate destructive cleanup of this database. Foundation resources and logs are retained on stack deletion and can continue to consume storage. Inspect and remove only explicitly identified unneeded retained resources after review. No cleanup command is run automatically.

References: [Aurora Express](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_GettingStartedAurora.AuroraPostgreSQL.ExpressConfig.html), [AWS CLI browser login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html), [Free Plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html), [budget limitations](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).
