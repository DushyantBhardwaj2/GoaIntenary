# AWS development backend verification

Verified 21 October 2026. The successful live run finished at 21:11 IST. This records backend infrastructure and API checks, not a production release or frontend browser review.

## Deployed resources

Region: Mumbai (`ap-south-1`). `goa-dev-foundation` and `goa-dev-runtime` both reached `UPDATE_COMPLETE`.

| Resource | Verified result |
| --- | --- |
| Core API | https://5f2nwbvfyf.execute-api.ap-south-1.amazonaws.com |
| Discovery API | https://2k8my0vn19.execute-api.ap-south-1.amazonaws.com |
| Cognito | `goa-dev-users`, no client secret, public signup disabled |
| Database | `goa-dev-postgres`, Aurora PostgreSQL Express 17.9, logical database `goa` |
| Database limits | IAM authentication, verified TLS, min 0/max 1 ACU, idle pause 300 seconds, one-day backups, deletion protection |
| SQL ownership | `goa_migrator` owns tables; `goa_core` has application DML and migration SELECT only |
| Runtime functions | `goa-dev-core`, `goa-dev-discovery`, `goa-dev-migrate`; bounded IAM roles and seven-day logs |
| Cost alerts | US$10/month; US$5/8/10 actual, US$10 forecast; exact owner-chosen subscriber and credit exclusion verified |

The initial credit read was US$100; the later Free Tier API read was US$160, still FREE, expiry 21 April 2027. No plan transition was requested. Alerts are not a cap; running-cost assumptions and cleanup are in [infra/README.md](../../infra/README.md).

## Live results

All eight groups passed in `node infra/scripts/smoke.mjs`:

1. Core health returned `status=ok`, `storage=postgres`, `authMode=cognito`.
2. Python Lambda health and the sourced Palolem catalogue query returned successfully.
3. Requests without authentication to private trips returned 401.
4. Three temporary Cognito users authenticated with real access tokens and loaded their profiles.
5. A trip persisted; repeating its idempotency key returned the same trip; an outsider received 404.
6. A second account accepted an invitation and read the shared private trip.
7. Published core Lambda version `1`, initialized separately from `$LATEST`, read the same persisted trip through its authenticated event.
8. Removing the member immediately caused its next private read to return 404.

The synthetic trip was soft-deleted and all three test Cognito identities were deleted. No test email was sent. Earlier failed test runs also removed their created identities. Synthetic SQL profile/audit/history records remain, consistent with soft-delete behavior. No real ticket, ID, payment or traveller data was used.

The live application SQL connection additionally verified TLS, no CREATE permission on the public schema, SELECT on migration metadata, no INSERT permission on that metadata, and contiguous migration versions 1–4. Migrations ran through the separate migration Lambda and its database owner role.

The cloud run caught a real Cognito compatibility error: provider subjects did not satisfy the previous RFC UUID variant constraint. AWS documents the `sub` as an Amazon Cognito-specific format. Validation now accepts PostgreSQL-compatible UUID text without requiring RFC version/variant bits; Cognito signature, issuer, access-token use, client, expiry, profile matching and trip-membership checks remain enforced. A profile/invitation/member-removal regression test passes. Source: [Cognito attributes](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html).

## Automated checks

- Core TypeScript check and all **63 tests** pass, including the new Cognito-subject regression.
- Python **51 tests** pass.
- Infrastructure TypeScript/synthesis/security checks pass; bundled core and migration handlers initialize with deployment restrictions.
- The deployment used a consistent source snapshot; deployed core ZIP SHA256 is `aa0081e6b7562c1663033aebf1f7ce52ffd64d08f72f52ef6b45730a79f8db00`.
- Credential-bearing configuration, output files and archives are ignored by Git; exported website environment contains no DB/AWS credentials.

## Operating limits and handoff

Run `npm run dev:aws` for the local website against these APIs, or `npm run dev:local` for the isolated synthetic environment. Deployment commands are in [infra/README.md](../../infra/README.md). `infra/artifacts/web.env` contains server configuration for a later Vercel preview; its APP_ORIGIN still needs the selected preview's exact URL.

Public Cognito signup, production/domain deployment, Vercel/browser flows, real email delivery, backup restore, observed idle pause/resume, and external Photon search-provider configuration remain outside this verification. No periodic DB health monitor was installed, because it would keep the database active. The complete cloud Stage 1 and pilot acceptance are not closed by these backend checks alone.
