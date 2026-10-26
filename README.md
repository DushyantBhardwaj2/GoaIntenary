# Goa Together

A private Goa trip planner with a coastal editorial landing page, optional interactive Three.js Tubes, sticky travel-story cards, source-backed discovery, saved trips, a manual day planner and INR budgeting. The existing invitation/approval and Cognito adapters are preserved. The AWS development backends and PostgreSQL are deployed and verified; Vercel/browser and production acceptance remain open. See [AWS setup](infra/README.md).

## Use the AWS development backends

Run `npm run dev:aws` to start the local website against the deployed Cognito/core/discovery services. `npm run aws:doctor` checks the AWS account and resources. Public Cognito signup remains disabled. [Deployment and verification notes](infra/README.md) include the separate Vercel server settings.

## Run locally

Requires Node.js 22 or newer (tested: Node 24), npm and Python 3.11 or newer. No Docker or AWS account is needed for the labelled local review.

```powershell
npm install
npm run setup:discovery
npm run dev:local
```

Open <http://127.0.0.1:3000>. Browse the public landing page or `/explore` without signing in. `/trips` and each trip workspace require authentication. The visible local-test banner identifies three **synthetic** accounts: Aman, Riya, and Dev (outsider). They exercise actual API permissions and server-saved trips on this computer, but are not Cognito registrations or multi-device cloud accounts.

Create a trip as Aman with dates, planned travellers, region, budget and travel styles. Add/edit/reorder/move activities, save a sourced place, and explicitly add it to a day. Record paid spending in Budget. Generate an invitation, switch to Riya to request access, then return to Aman to approve it. Dev cannot read a copied private trip URL, and removing Riya blocks her next request. Trip settings/deletion are organiser-only. Deletion hides trip resources while preserving database/audit history.

Trip data persists in ignored `.data/core/` using PGlite, an embedded PostgreSQL engine. Local sessions expire, and restarting the launcher changes the signing secret, so sign in again after a restart. Keep this mode on your own computer with synthetic data. It is disabled in production and Lambda.

The website, core API and Python discovery run on loopback ports 3000, 4000 and 4100. Set `WEB_PORT`, `CORE_PORT` and `DISCOVERY_PORT` to distinct free ports if necessary. Stop with Ctrl+C. Dependency setup uses a service-local Python environment and pinned requirements; set `GOA_PYTHON` if Python is not on PATH.

Discovery is a small reviewed collection of 16 official-source places, with source/check dates and approximate reference coordinates. It is not live business inventory, ratings, hours or complete Goa coverage. The illustrative landing itinerary is never silently saved.

Budgets keep activity estimates separate from recorded paid spending. For a ₹20,000 budget, ₹8,000 in estimates and ₹1,250 paid, remaining actual budget is ₹18,750. The headcount averages remain planning figures. **Budget & splits** separately calculates real selected-person shares and balances: choose the payer, check only the travellers sharing the bill, then use equal or custom INR shares. A ₹4,000 bill split four ways creates ₹1,000 shares; excluded travellers owe nothing for that bill, and the payer can be outside the selected four. Organisers can add named guests without giving account access. Record external repayments to reduce balances; no money is transferred by the app. Existing expenses stay marked not split until explicitly allocated.

Explore now includes an interactive Leaflet map using the same filtered results as the list. Each itinerary day has numbered pins in its manual activity order. Pins open the existing save/edit action, custom activities accept optional coordinates, and the list remains usable if maps fail. Approximate reference pins do not imply entrances, calculated routes or travel times. Standard OpenStreetMap tiles are used for modest interactive local viewing with visible attribution and normal browser caching; no offline downloads or prefetch. Production tile hosting remains a separate decision.

Search inside the map for a beach, café or landmark. Suggestions combine reviewed places with source-labelled Goa OpenStreetMap/Photon results; “Palom Beach” also finds Palolem. Choose a result to focus/highlight its pin, then Add to itinerary or Save for later. Public browsing asks for a trip; a private map starts with its current trip/day. Nothing is scheduled until the activity form is saved. Wider search is cached/throttled and reports provider failures honestly. The local Photon demo needs no key; a production deployment must configure a suitable server-only `PHOTON_API_URL`.

## Checks

```powershell
npm run typecheck
npm test
npm run test:discovery
npm run build
npm run verify:splits # with dev:local running
```

With `npm run dev:local` already running, `npm run verify:local`, `npm run verify:planner` and `node scripts/independent-planner.mjs` exercise the actual local BFF and APIs. They use synthetic accounts and refuse non-loopback targets; planner fixtures are soft-deleted at the end. The earlier private-trip verification leaves labelled synthetic records. See [Slice 01](docs/slices/01-handoff.md), [the premium planner handoff](docs/slices/02-handoff.md) and [independent acceptance report](docs/verification/02-premium-planner.md) for exact results and remaining gates.

The API tests use synthetic identities and isolated embedded databases. Read `docs/verification/` for independent results and what remains untested. A passing local build does not close the AWS/Vercel stage gate.

## Real development accounts

After the account and cost gates in [docs/stage-0.md](docs/stage-0.md) are satisfied, copy `.env.example` to `.env` and supply the development Cognito pool/client and PostgreSQL connection. Run `npm run dev`. Cognito handles email/password, verification, and reset; the application does not store passwords. Browser sessions use HTTP-only cookies and the core service verifies identities and membership. Do not place credentials in public `NEXT_PUBLIC_` variables.

The web BFF talks to `CORE_API_URL`. Vercel and AWS deployment require their development environment configuration; nothing is provisioned by installing or running the local app. Cloud credits, an active budget alert, live Cognito email delivery, and cloud user-journey verification must be evidenced before calling Stage 0/1 complete.

## Project contracts

- [Product plan](plan.md) and [working instructions](agent.md).
- [Slice 01 HTTP and permission contract](docs/slices/01-private-trips.md).
- [Premium planner HTTP, money and visual contract](docs/slices/02-premium-planner.md).
- [Map and selected-traveller ledger contract](docs/slices/03-map-and-splits.md) and [handoff](docs/slices/03-handoff.md).
- [Dynamic map search and itinerary handoff](docs/slices/04-handoff.md); reproduce with `npm run verify:map-search` against the running local preview.
- [Visual lifecycle and reference-package decision](docs/decisions/2026-10-21-premium-visuals.md).
- `apps/web/`: Next.js UI, auth/session adapter, and same-origin BFF.
- `services/core-api/`: Fastify API, SQL schema, identity and membership checks.
- `services/discovery/`: Python FastAPI public reviewed catalogue and search; source notes/runbook included.
- `infra/`: development cost/preflight tooling; no deployed resources yet.

The optional Three.js effect is lazy, capped at 30fps/DPR1.5, pauses offscreen, and cleans up its resources. Reduced motion, coarse pointers, low hardware capacity and data-saver use original static SVG; core planning needs no WebGL. Story cards become ordinary vertical cards on narrow/reduced-motion layouts. Rendered GPU/phone/keyboard/scroll checks remain untested because browser security policy blocked automated preview inspection; build/source checks are not visual evidence. Existing email challenge/rotation/account-deletion limits are documented in `apps/web/README.md`.
