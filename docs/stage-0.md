# Stage 0: account, hosting and cost gate

Checked 21 October 2026 (Asia/Kolkata). **Status: AWS development account/cost gate accepted and backend deployed; Vercel/browser and production/restore gates remain open.** The latest evidence below supersedes the historical assessment. See [live deployment verification](verification/07-aws-backend.md).

## Later account connection evidence (same day)

This update supersedes the earlier local-access findings below. AWS CLI v2.38.3 was downloaded from AWS's official distribution, its Amazon publisher signature was verified, and it was extracted into ignored `.tools`. The owner completed browser sign-in for the intended account; no long-lived key entered Git. The temporary session is a root identity, which AWS does not permit to assume IAM roles directly. Runtime provisioning therefore executes through the scoped CloudFormation service role `goa-dev-deployer`, with bounded Lambda roles. The unusable direct-assumption CLI profile created during setup was removed; `goa-dev` remains the browser profile.

`GetAccountPlanState` verified **FREE**, initially **US$100 remaining**, and **21 April 2027 at 08:36 UTC** as expiry. A later read after provisioning reported **US$160 remaining**, still FREE; the reason for the increase was not independently inspected. No pool, database, Goa stack or budget existed before this work. The owner approved **US$10** usage alerts to the supplied NSUT recipient. AWS saved the exact subscriber, actual thresholds US$5/8/10, forecast US$10 and credit exclusion. Saved configuration is verified; email delivery is not independently observed.

The deployed low-traffic database is **Aurora PostgreSQL Express 17.9**, min 0 / max 1 ACU and 300-second idle pause. It uses the managed IAM-only gateway and verified TLS, with deletion protection and one-day backups. AWS rejected seven-day retention on this Free Plan and an initial database name in Express creation; bootstrap creates `goa` through SQL afterward. A retained CDK custom resource bundles the current RDS SDK because CloudFormation's DBCluster does not expose Express. No customer VPC/NAT, Data API adapter or stored DB password is required. The separate SQL application role is verified unable to create schema objects or modify migration records. See [cost/operating notes](../infra/README.md).

Verification: core 63 tests, Python 51 tests and infrastructure typecheck/synthesis/security assertions pass. Both stacks are UPDATE_COMPLETE. Eight live backend groups pass: real PostgreSQL/Cognito health, discovery catalogue, unauthenticated denial, three Cognito identities, retry-safe private trip and outsider denial, member invitation, fresh Lambda persistence, and removed-member denial. Synthetic accounts were deleted. A live Cognito subject-format incompatibility was fixed without changing JWT signature/issuer/client checks. No Vercel preview, browser account flow, backup restore or observed idle pause is claimed. The older absent-CLI/authentication findings below are historical.

## Account and local evidence

| Check | Result | Evidence / limit |
| --- | --- | --- |
| AWS connection | Not available | No AWS connector tools were exposed; `aws` was not on PATH or at the standard Windows AWS CLI v2 path. |
| AWS credentials | No usual local configuration detected | `~/.aws/config` and `~/.aws/credentials` do not exist. No environment-variable names beginning with AWS were present. No credential values were read. This does not establish whether credentials exist elsewhere. |
| AWS console session | Not available | Enabled browser inventory contained only empty in-app and MCP Apps surfaces. No AWS console tab was available. |
| Plan / remaining credits | **Owner-reported Free Plan; US$100 remaining** | The owner supplied Billing console text saying the Free Plan is not charged and access ends at plan expiry or credit depletion. This supersedes the earlier approximate US$450 assumption. The agent has not independently signed into Billing. Account identifiers are deliberately omitted. |
| Credit expiry and exact service eligibility | **Not verified** | The supplied console text did not include the expiry date or eligible-products detail. |
| Existing spend, budget and alert delivery | **Not verified / not changed** | No AWS budget was created and no alert was sent. Account-wide costs could include unrelated projects. |
| Vercel connector | Read-only project listing works | Two Goa-named projects were returned. Their relationship to this repository was not established; neither was modified or selected as the deployment target. |
| Vercel billing plan / team access | Not verified | Team metadata returned 403 missing scope grant. Vercel CLI and usual CLI auth-file paths were absent. Listing visibility does not prove deployment or billing access. |
| Local runtimes | Node 24.20.0; Python 3.11.9 | Executables were available. Package-specific support is verified by the implementing service. |
| Local PostgreSQL / Docker | Docker CLI installed; engine unavailable | Docker reported missing `dockerDesktopLinuxEngine` pipe. `psql`/`pg_ctl` were unavailable; no local 5432 listener was found. No Docker service or database was started. |
| Local database path | Embedded PostgreSQL for the local slice | The core creator is implementing file-backed PGlite plus a separate `pg` adapter. Local results do not verify RDS networking, PostgreSQL wire connections, IAM, failover or cloud durability. See the actual slice checks for pass/fail evidence. |

No cloud resource, deployment, email, account setting or paid subscription was created by this assessment. The only external operations were documentation/public-pricing reads, read-only Vercel account calls and browser inventory.

## Credit and budget action needed before provisioning

The smallest AWS action is to open the intended account's Billing console in an accessible browser session, or provide a short-lived least-privilege AWS profile with billing-read access. Keep passwords, access keys and full account identifiers out of chat and Git. Billing access may need to be explicitly enabled for an IAM identity; operational account access alone does not establish credit visibility.

In Billing **Credits** (or AWS Settings for the new signup experience), inspect the credit's status, estimated current remaining amount, expiry and applicable products. Check the Free Plan's separate end date/days remaining. Reconcile with **Bills / Savings** because settled and estimated balances can differ. Record only a redacted confirmation of the amount, expiry, eligible services and check date. The [AWS credit-viewing guide](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html) describes these fields.

The owner's reported Free Plan is distinct from a Paid Plan with promotional credit. [AWS's plan guide](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html) says the Free Plan incurs no charges while it remains active; it ends after six months or credit exhaustion, whichever comes first. The account then closes and access to resources/data ends; AWS describes a 90-day retention/recovery period. Continued use requires an owner decision about a Paid Plan. **No upgrade is requested or authorized by this assessment.** Export/back up needed data before expiry; do not use plan closure as a backup strategy. The exact account end date remains unknown.

If the owner later chooses a Paid Plan, usage outside available/eligible credits can be billed. [AWS promotional credit terms](https://aws.amazon.com/awscredits/) limit credits to designated services and exclude taxes and specified fees such as Marketplace, domain registration/transfer, certain support tiers and upfront commitments unless separately allowed. Those general terms do not establish this Free Plan's exact eligible products. Vercel and MapTiler remain separate vendors regardless of AWS plan. Avoid Organizations/Control Tower or paid-only/advanced feature activation as a workaround; AWS documents plan transitions associated with some of those actions.

### Free Plan service restrictions

The official [Aurora/RDS Free Tier page](https://aws.amazon.com/rds/free/) currently permits RDS `db.t3.micro` / `db.t4g.micro` for PostgreSQL and certain other engines. It describes Aurora PostgreSQL serverless on the Free Plan with **up to 4 ACU and 1 GiB storage per cluster**. Therefore `db.t4g.small` and the 20 GB Aurora examples below are comparison scenarios for a different/paid configuration, not assumed deployable on this account. RDS Single-AZ micro remains a candidate; verify its allowed storage/version and account quotas before selecting CDK properties. The [RDS guide](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/) lists further Free Tier restrictions including Single-AZ only and no reserved DB instances.

AWS's [new signup supported-services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html) includes Cognito, API Gateway, Lambda, RDS, Aurora, S3, SQS, EventBridge, SES, CloudWatch, IAM, CloudFormation, Secrets Manager and Budgets in its Free Tier section. It explicitly warns that the new experience is rolling out to limited customers and restricts multi/cross-region features. This is public support evidence, not proof of this specific account's API permissions or feature eligibility. Cognito's service inclusion/free monthly tier does not establish that every tier, quota, SMS or email path is available without charges or restrictions.

CDK authoring/synthesis can proceed locally, but a CDK deploy uses CloudFormation, IAM roles, an asset bucket and possibly other bootstrap services. Confirm those operations are allowed in this exact account experience; neither bootstrap nor deploy has run. The [Aurora Free Plan announcement](https://aws.amazon.com/about-aws/whats-new/2026/03/amazon-aurora-postgresql-aws-free-tier/) describes express configuration through the console/CLI/SDK; do not assume a generic CDK cluster is equivalent to that restricted creation path. No IAM grants, advanced features, account transitions or cloud resources were created to probe eligibility.

**Provisional development ceiling: US$25 per month in gross AWS resource usage/credit consumption**, subject to owner review and the final network design. This is not a claim that the Free Plan currently charges cash. Configure actual-cost alerts at 50%, 80% and 100% ($12.50 / $20 / $25), plus forecast 100%. Use unblended monthly COST with `IncludeCredit=false` and `IncludeRefund=false` so credits do not conceal usage. Also monitor Free Plan days/credits remaining and export data before the earlier stop condition. If applicable, include tax/support/subscription charges in the budget. The scenarios below exclude tax. Choose a verified recipient before creating notifications; no recipient was guessed.

Prefer a project-tagged budget after the `Project=goa` cost allocation tag is activated, plus an account-wide catch-all suitable for the owner's other workloads. Untagged and unsupported charges may otherwise be missed. Inspect existing budgets before adding duplicates. Confirm the saved thresholds, cost filters and subscriber state in AWS after creation. For SNS delivery, confirm the subscription and test with a permitted test notification. A newly created budget by itself does not prove delivery.

Monitoring/notifications are currently free under [AWS Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/). Budgets are delayed monitoring, not a hard spending cap: AWS describes typical updates 8–12 hours apart and possible further billing delay in its [Budgets guide](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html). Review spend weekly, limit Lambda concurrency/log retention and investigate at 80%; avoid automatic destructive shutdown of a database. The [CostTypes API](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_CostTypes.html) documents credit/refund flags.

## Verified Mumbai database prices

Region: Asia Pacific (Mumbai), `ap-south-1`. The website pricing tables did not expose Mumbai values to the document retriever. We instead fetched the official regional [AmazonRDS public price catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-south-1/index.json). Catalog publication: **2026-10-20T00:32:32Z**; retained price dimensions effective **2026-10-01**; fetched **2026-10-21T09:47:45Z**. These are public USD on-demand list prices, not the account's bill or a calculator quote.

| Item | Mumbai list price |
| --- | ---: |
| Aurora PostgreSQL Serverless v2 Standard | $0.18 / ACU-hour |
| Aurora Standard consumed storage | $0.11 / GB-month |
| Aurora Standard storage I/O | $0.22 / million I/O requests |
| RDS PostgreSQL `db.t4g.micro`, Single-AZ | $0.021 / instance-hour |
| RDS PostgreSQL `db.t4g.small`, Single-AZ | $0.042 / instance-hour |
| RDS PostgreSQL gp3, Single-AZ | $0.131 / GB-month |
| Aurora Serverless v2 I/O-Optimized | $0.24 / ACU-hour; $0.248 / GB-month |

The [retained snapshot](../infra/pricing/ap-south-1-rds-2026-10-21.json) includes product SKUs, region, units and descriptions. Reproduce with this read-only command, which requires internet access but no AWS account or credentials:

```powershell
python infra/scripts/price-snapshot.py --region ap-south-1 --output infra/pricing/ap-south-1-rds-current.json
```

The script excludes unused capacity-reservation products. It does not create resources. The public endpoint may change; failure or missing products must be treated as unverified pricing, not zero cost.

### Assumption-based monthly scenarios

Use 730 hours/month; one writer or one Single-AZ RDS instance; 20 GB database storage; Aurora Standard 1 million storage I/O/month; no read replicas, Multi-AZ failover instance, NAT gateway, paid interface endpoints, proxy or public database IP. Aurora average active capacity is **assumed 0.5 ACU**; an active hour includes auto-pause waiting time. No free tier, credit or long-term reservation is deducted. **These are gross list-price comparisons, not a cash-billing forecast for the reported Free Plan.** Its 1 GiB Aurora storage cap rules out the illustrated 20 GB Aurora configurations; micro RDS eligibility still needs exact account confirmation, while small RDS is outside the published Free Plan instance list.

Formula: Aurora = `active hours × mean ACU × $0.18 + 20 × $0.11 + 1 × $0.22`. RDS = `730 × instance hourly price + 20 × $0.131`.

| Scenario | DB subtotal / month | With $5 shared-service planning allowance |
| --- | ---: | ---: |
| Local embedded PostgreSQL only; no cloud deployed | $0 AWS resources created | $0 created by this work |
| Aurora, 60 active hours/month at 0.5 ACU | $7.82 | $12.82 |
| Aurora, 240 active hours/month at 0.5 ACU | $24.02 | $29.02 |
| Aurora, 730 active hours/month at 0.5 ACU | $68.12 | $73.12 |
| Aurora, 730 active hours/month at 1 ACU | $133.82 | $138.82 |
| RDS `db.t4g.micro`, 730 hours + 20 GB gp3 | $17.95 | $22.95 |
| RDS `db.t4g.small`, 730 hours + 20 GB gp3 | $33.28 | $38.28 |

The $5 is a **planning reserve, not a verified quote or included credit**: $0.50 API Gateway/Lambda, $0.25 S3 objects/requests, $1 logs/metrics, $0.50 secrets, $0.25 auth/SES/queues/schedules, $0.50 additional backup storage and $2 transfer. It assumes an invited pilot (about 100 monthly users, 100k API requests, sub-GB object/log ingestion, limited downloads) and must be replaced with actual regional calculator inputs before deployment. Email, file processing and queues need not be provisioned for the first trip slice. [API Gateway](https://aws.amazon.com/api-gateway/pricing/), [Lambda](https://aws.amazon.com/lambda/pricing/), [S3](https://aws.amazon.com/s3/pricing/), [Cognito](https://aws.amazon.com/cognito/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/) and [SES](https://aws.amazon.com/ses/pricing/) prices remain separate line items, not evidence that the reserve will suffice.

Additional costs/limits to price explicitly: burst CPU credits on T4g, backup beyond included allowance, retained/manual snapshots after DB removal, storage growth, engine Extended Support, logs/alarms, downloads and cross-AZ/region traffic. gp3 has a 20 GiB PostgreSQL minimum and baseline IOPS/throughput in the [RDS storage guide](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html); do not buy extra IOPS by default. Use a supported major engine version and retain a restore-tested backup before storing real data.

At these assumptions Aurora's DB subtotal equals the micro RDS subtotal near **173 active hours/month**. Networking and Data API request charges can change that comparison. An ACU ceiling limits capacity, not all resource consumption. Do not derive a number of usable months from the reported $100: the unknown Free Plan end date and service restrictions can stop usage first.

## Region and networking checks

AWS lists Mumbai support for [Aurora Serverless v2](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.ServerlessV2.html) and the [Aurora PostgreSQL Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.Data_API.html). The Data API table currently lists 17.4+, 16.1+, 15.3+, 14.8+, 13.11+ in Mumbai. These are feature minima, not a recommendation to choose an old major version. Verify the exact currently orderable/supported engine minor and account quotas through `DescribeOrderableDBInstanceOptions` / `DescribeDBEngineVersions` before CDK deployment.

[Auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html) requires min capacity 0 and a supported version (the document gives minimum PostgreSQL 16.3, 15.7, 14.12, 13.15; verify newer major versions separately). The minimum inactivity interval is 300 seconds. Storage remains billable. Open user connections and RDS Proxy prevent pausing; frequent health checks/Data API calls can also keep it awake. Resume is typically around 15 seconds and can be longer after extended inactivity. Test a user-visible retry/loading path, connection handling and idempotent writes; never budget assuming every gap between requests is paused time.

For direct `pg` connections, keep RDS private and Lambda in the database VPC with narrowly scoped security groups. Putting Lambda in a public subnet does **not** provide public internet, as the [Lambda VPC guide](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html) explains. Decide how Secrets Manager, Cognito/JWKS and other outbound calls work before declaring a NAT-free design functional. API Gateway's JWT authorizer and Vercel-side auth may remove some runtime outbound requirements, but that architecture must actually be tested. Paid interface endpoints can also dominate a small budget; an S3 gateway endpoint has no hourly gateway fee.

Alternatively, [Aurora Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html) provides an HTTPS SQL interface and Secrets Manager integration, allowing callers outside the DB VPC. It requires explicit IAM and SQL permissions and a Data API-compatible persistence adapter; the local `pg` adapter is not that adapter. Include Data API request and Secrets Manager costs. Do not add RDS Proxy to an auto-pause design.

No NAT gateway is included in the scenarios. The [VPC pricing page](https://aws.amazon.com/vpc/pricing/) documents hourly plus per-GB NAT charges; its Ohio example alone is $0.045/hour, or $32.85 at 730 hours, before data/IP charges. That example is **not a verified Mumbai NAT quote**. Fetch the actual Mumbai price if NAT is required; it can make the $25 ceiling infeasible. Public IPv4 is $0.005/hour ($3.65/month per address at 730 hours). Do not expose the database publicly as a cost shortcut.

## Separate Vercel and map costs

| Vendor / proposed use | Public price checked 21 October 2026 | Gate |
| --- | --- | --- |
| Vercel Hobby, personal non-commercial pilot | $0/month within plan limits | Actual account plan and repository target not verified. |
| Vercel Pro alternative | Advertised $20/month base with $20 included usage credit | Seat/usage/overage/tax conditions need account confirmation; AWS credits do not pay it. |
| MapTiler Free for personal testing/private pilot | $0/month; published 100k API requests/month, 5k sessions/month | Requires account/key and non-commercial eligibility; no key or account was created. Leaflet tile calls consume the API-request allowance. |
| MapTiler Flex for standard/commercial use | $30/month; published 500k API requests/month and 25k sessions/month | Published extra API requests $0.15/1k; verify applicable meter and account controls. |

Sources: [Vercel pricing](https://vercel.com/pricing), [Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines), [MapTiler pricing](https://www.maptiler.com/cloud/pricing/), [MapTiler terms](https://www.maptiler.com/terms/cloud/). For Leaflet raster tiles a 512×512 rendered tile counts as four requests; 256×256 counts as one, so a map session is not a single tile request. Free quotas and commercial eligibility must be rechecked before launch. Display the required MapTiler branding and OpenStreetMap/provider attribution, restrict browser keys by allowed origin and keep a working list view when tiles are unavailable.

For the illustrated RDS micro case, gross AWS list-price usage $22.95 plus personal Vercel/MapTiler free plans is **$22.95 before tax**; upgrading both vendors adds **at least $50/month** before usage/tax. While the account remains on the reported AWS Free Plan, eligible usage consumes credit instead of implying a cash invoice. This is an assumption scenario, not the user's current bill or proof of eligibility.

The public `tile.openstreetmap.org` service is not the selected production tile host. Its [tile policy](https://operations.osmfoundation.org/policies/tiles/) requires visible attribution, normal browser identification/referrer and proper caching, prohibits bulk/offline prefetch, and offers best-effort availability with possible blocking. OSM data availability does not grant unlimited free hosted tiles. Do not implement offline map downloads against it.

## Provisional recommendation and exit gates

1. Keep Mumbai as the candidate AWS region and local embedded PostgreSQL for the current slice. No cloud is selected merely by this recommendation.
2. Prefer private Single-AZ RDS PostgreSQL `db.t4g.micro` + 20 GB gp3 for an always-available small development pilot **if** that exact Free Plan configuration is eligible, a secure network/secret path fits the $25 gross ceiling and memory/CPU testing passes. It has less unpredictable idle compute than continuously awake Aurora. It is not a production high-availability design, and plan expiry is an explicit availability limit.
3. Consider Aurora Standard with min 0 only for deliberately intermittent development where the Free Plan's 1 GiB limit and express configuration meet the slice's needs, measured active hours stay low, resume latency is accepted and an appropriate Data API adapter or closed-connection path is implemented. A larger configuration requires a separate owner plan decision. Do not choose it on the expectation that “serverless” implies free idle operation in every design.
4. Provisionally choose MapTiler Free for a personal non-commercial pilot; defer any subscription. Revisit Flex/provider alternatives if the use becomes commercial or quota requirements grow.
5. Before provisioning: independently verify the reported Free Plan/$100, its end date, actual credit expiry and eligible configuration; review the budget/recipient; establish the intended Vercel project and plan; check engine orderability and complete regional cost lines including networking; then create/verify the spending alert. If an authenticated Pricing Calculator is unavailable in this account experience, use public list-price calculations and document that limit instead of enabling advanced features. Keep final region/database selection and alert evidence in the decision log.
6. Before a cloud stage is marked complete: deploy only the intended development resources through reviewed CDK, test the real Cognito multi-account path from a Vercel preview, confirm access/secret/network boundaries and restart persistence, record costs/resource names, and document snapshot/cleanup routes. Local passing tests cannot close this cloud acceptance gate.

No cloud authentication blocker prevents the authorized local trip/invitation slice from progressing. The next required owner input is an accessible AWS billing session/profile and the intended Vercel target; credentials should be entered through the provider, not pasted into chat.
