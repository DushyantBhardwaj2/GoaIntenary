# Copy this prompt into a new Codex session

Work in `C:\Users\Dushy\OneDrive\Documents\ChatGPT\GOA`. I want you to build the Goa trip companion **step by step through vibe coding**. I will describe the product and test working previews; you should write the code, manage the implementation, and verify it. Treat this message as authorization to create local application code and development infrastructure needed for a working preview, subject to the cost and account-access gates below. Do not treat planning files as completed implementation.

Read `AGENTS.md`, `agent.md`, and `plan.md` first. They contain the current product contract. Then inspect the repository and the project-local skills under `skills/`. Tell me what exists, which stage is next, and what you will deliver in the first working slice. Keep the original scope: email/password only; private group trips; Goa search and map; fully manual itinerary; shared expenses; travel/stay records; shared bookings and optional private identity documents; wishlist/voting; checklist; budget comparison; reminders; PDF itinerary; contacts; weather; and activity comments.

## Agreed stack

- Website: mobile-first Next.js, React, and TypeScript, deployed to Vercel previews.
- Core backend: TypeScript Fastify on AWS Lambda/API Gateway for private trips, itinerary, membership, expenses, bookings, and document authorization.
- Discovery backend: Python FastAPI for Goa places, events, and search, with Python Lambda handlers for queued/scheduled work such as reminders and document processing.
- Identity: Cognito email/password accounts with verification and reset. No OAuth/social login and no application password table.
- Data: PostgreSQL on AWS. Aurora Serverless v2 is the candidate, but complete the Aurora-versus-small-RDS cost and region comparison before provisioning.
- Files: private S3; SQS/EventBridge for real background work; SES when production sending is available.
- Map: Leaflet with a production-suitable OpenStreetMap-derived tile service, plus an external navigation link.
- Infrastructure: AWS CDK in TypeScript. On 21 October 2026 the owner reported US$100 remaining on AWS Free Plan, superseding an earlier US$450 estimate. Verify current remaining credits, plan end date, eligible services and account restrictions rather than assuming paid-plan access. Do not upgrade the plan automatically. Vercel and map costs are tracked separately.

## Multi-agent team

Use real subagents through the available collaboration tools. I want visible, useful division of work, including an independent verifier and a coordinator who keeps the parts working together. **You are the coordinator and integrator.** Do not create separate user-owned sidebar chats as a substitute for subagents. This host may allow only four active agents including you, so run no more than three children concurrently and schedule the other specialties in later waves. If availability differs, respect the actual limit. Never claim an agent is working unless it has a concrete assigned task.

Create or reuse subagents for these responsibilities as the current slice needs them:

1. **Website creator** — owns `apps/web/`, screen flows, mobile design, map/list interaction, forms, and frontend integration. Read `skills/goa-web/SKILL.md`.
2. **Core API creator** — owns `services/core-api/`, private trip behavior, membership, transactions, and API contracts. Read `skills/goa-core-api/SKILL.md` and `skills/goa-auth/SKILL.md` when relevant.
3. **Python creator** — owns `services/discovery/`, public places/events, freshness, weather, and Python workers. Read `skills/goa-discovery/SKILL.md`.
4. **Money specialist** — applies `skills/goa-expenses/SKILL.md` to the ledger implementation or review when expenses are in scope.
5. **Document and privacy specialist** — applies `skills/goa-documents/SKILL.md` to upload/access design and review when files are in scope.
6. **Platform specialist** — owns AWS CDK, development AWS setup, Vercel previews, logging, and cost controls. Read `skills/goa-platform/SKILL.md`.
7. **Independent verifier** — owns acceptance review, adversarial access checks, browser/API checks, and retesting after fixes. Read `skills/goa-verify/SKILL.md`. The verifier must not be the author of the same feature it reviews.

You, the coordinator, use `skills/goa-orchestrate/SKILL.md`. Assign a short contract to every child: objective, files owned, API/event interfaces, acceptance evidence, and expected handoff. Agree on contracts before parallel coding. Avoid simultaneous edits to the same files. Ask for progress at sensible intervals, resolve blockers and incompatible interfaces, integrate the work, and run the complete flow. Bring in the verifier after the creators produce something runnable. You can rotate agents across stages; do not keep every specialty active without useful work.

A practical rotation is: at Stage 0, let platform, core, and discovery agents investigate separate prerequisites while you integrate the stack decision; at Stage 1, let web, core, and platform build disjoint parts, then replace a creator with the verifier for an independent pass; at Stage 2, let Python, web, and core agree on place-to-itinerary contracts, then verify; at Stage 4, pair core with the money specialist and web, then verify ledger behavior; at Stage 5, pair core, Python, and the document specialist, then verify access with distinct accounts. Adjust this rotation to actual dependencies and available tools. If subagent tools are unavailable, say so and execute the roles sequentially rather than inventing agent activity.

At each milestone, give me a brief truthful status: who owns what, what is already working, what is still unverified, and what happens next. Use clear names, not a wall of agent logs. I want to see evidence of collaboration, not a simulation of activity.

## Build sequence

Follow `plan.md` and deliver vertical slices that include the necessary frontend, API, data, and tests. Suggested order:

1. **Stage 0 — readiness and cost gate.** Inspect the empty or existing repo, verify connected Vercel/AWS access, AWS credit eligibility/expiry, budget alerts, Mumbai region availability, Aurora versus small RDS PostgreSQL cost for a low-traffic pilot, and map tile terms. Record the selected database and any unresolved account step. You may build local scaffolding while waiting for account access; do not pretend a cloud service is provisioned.
2. **Stage 1 — accounts and private trips.** Create the repository structure, development configuration, Cognito email/password flow, trip creation, invitation acceptance, member list, and a Vercel preview. Test two members and an outsider.
3. **Stage 2 — Goa discovery and map.** Build a reviewed catalogue, admin entry/update flow, public search and filters, map/list views, event dates and freshness, and Add to trip. Use sourced content; avoid fabricated current events.
4. **Stage 3 — manual planning.** Make day timelines, custom pins, ordered stops, attendance, travel/stay records, wishlist/votes, and comments work across accounts. The AI must not auto-generate or silently reorder an itinerary.
5. **Stage 4 — expenses.** Build INR expense entries, participant splits, category budgets, balances, suggested settlements, and recorded external repayments. Verify the ledger formula, rounding, edits, subgroup costs, and removed members.
6. **Stage 5 — documents and trip utilities.** Build private/shared file storage, document processing and access controls, checklists, contacts, reminders, weather with freshness, and a PDF itinerary that excludes private IDs.
7. **Stage 6 — pilot.** Run the complete three-day group scenario in `plan.md`, check mobile usability, restore procedure, content freshness, logs, and actual cloud spend. Fix the high-impact failures before any public launch.

Complete one working slice and show its evidence before expanding to the next. When a slice is small, continue useful work rather than waiting for routine permission. If a decision materially changes costs or product behavior, present the concrete choice and what you already verified. Keep `plan.md` and `agent.md` aligned with agreed changes.

## Rules for trustworthy vibe coding

- Never replace a real backend feature with a static mock while claiming the feature works. Use clearly labelled synthetic data only for tests and previews that need it.
- Give the browser no authority to decide trip access or financial balances. APIs check membership and transactions. Use exact money values, not floating point.
- Treat identity documents and tickets as sensitive. Keep S3 private and make personal files private to the owner. Test access with multiple accounts, including a non-member and a removed member.
- Distinguish permanent places from dated events. “Happening now” means scheduled within a sourced time window; it is not a live crowd or ticket feed.
- Use current official docs for named AWS/Vercel/framework APIs during implementation. Avoid copying undocumented examples into the app.
- Keep secrets, AWS credentials, passwords, real Aadhaar images, and real tickets out of Git, logs, and chat output. Use sample files for tests.
- Use Vercel previews and a development AWS environment. Check cost and rollback before provisioning resources. Do not infer that AWS credits cover all services or Vercel. Production release and a public domain are separate decisions.
- After each meaningful change, run the checks that prove the behavior. The independent verifier reports Pass, Fail, or Not tested with reproduction steps; creators fix findings; the coordinator retests the full journey.

## How to report back to me

For each stage, tell me: the user-visible result, which agents contributed, files changed, test evidence, preview URL if it exists, new AWS/Vercel resources and current spend implications, known limitations, and the next slice. If an account connection or cloud setup blocks part of a stage, complete the local and read-only work first, then ask me for the smallest missing action. Keep going until the currently authorised stage has a concrete reviewable result.

**First action now:** inspect the repository and planning files, load the orchestration skill, determine Stage 0 tasks, delegate bounded read-only architecture or cost checks where useful, and return a concise Stage 0 finding followed by the first implementation slice. Do not make up credit balances, deployments, or test results.
