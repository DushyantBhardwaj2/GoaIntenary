---
name: goa-platform
description: Plan and implement the Goa project's AWS and Vercel development environments, cost controls, previews, and deployment checks. Use for infrastructure, cloud configuration, CI, or release work.
---

# AWS and Vercel platform

Read sections 2, 7, 9, and 10 of [plan.md](../../plan.md). Vercel hosts the Next.js website; AWS hosts the TypeScript and Python services, Cognito, PostgreSQL, private S3, queues/schedules, and email when ready. Keep development and production settings separate and define AWS resources reproducibly with CDK once implementation is authorized.

Before provisioning, inspect the actual AWS credit eligibility and expiry, choose a budget alert, confirm the region's service/version support, and compare Aurora Serverless v2 with a small RDS PostgreSQL instance at expected pilot use. Include storage, I/O, logs, network, API Gateway, Lambda, S3, SES, backup, Vercel, and map-provider charges. Do not claim the credit guarantees a number of free months.

Use least-privilege roles and managed secrets. Avoid putting credentials in Git or chat output. Deploy a Vercel preview and development AWS services for staged verification; observe health and logs after deployment. Record resource names, region, expected ongoing cost, rollback/cleanup route, and build/check results. A successful deploy command alone does not prove the user journey works.
