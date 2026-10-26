# Slice 02 handoff — Goa Together premium planner

21 October 2026. Implements the owner's [premium planner contract](02-premium-planner.md) in the existing Next.js/React, Fastify/PostgreSQL and Python service architecture. Local implementation and automated/API verification are complete. Rendered visual acceptance and deployed cloud acceptance remain open, as detailed below.

## Working result

The public landing page uses the Goa Together wordmark, sun, original coastal illustrations, editorial typography and the specified green/ivory/coral palette. It includes meaningful navigation, discovery links, a clearly illustrative itinerary, collaboration content and five sticky travel-story cards. An original lazy-loaded Three.js Tubes scene responds to the pointer and cycles approved colours on background clicks; its permanent SVG fallback supports reduced motion, coarse pointers, data saver and unsupported WebGL. Forms and planning controls have no decorative canvas behind them.

My Trips supports sorting, creation, reopening, organiser settings and soft deletion. The three-step form saves dates, region, planned travellers, interests and an optional exact INR budget. Each private workspace contains date-derived itinerary days, an unscheduled list, activity editing, notes/meeting points, manual reorder/move controls, saved places, spending and member/invitation management. Stale activity/expense edits receive a conflict instead of silently overwriting another edit. Date changes cannot orphan activities.

The separate Python FastAPI service provides search, category/region filters and detail endpoints over sixteen reviewed Goa Tourism source-backed places. The UI shows source/check dates and approximate coordinate notices, with empty/error states. Saving a place does not schedule it: adding it to a chosen day is explicit. This small catalogue does not claim live business ratings, prices, hours or booking availability.

Paid expenses record a payer, category, date and amount, with authorised edits/deletion and audit history. Core calculations use integer paise and keep estimates separate from paid spending: a ₹20,000 budget, ₹8,000 estimated activities and ₹1,250 paid leaves ₹18,750. Per-person figures are approximate planning averages using the planned traveller count. Shared splits, debts and repayments are not implemented or claimed.

The original Cognito adapter, cookie-based BFF, invitation approval and server-side membership rules remain. Local review uses labelled synthetic Aman/Riya/Dev accounts and file-backed PGlite, not fake cloud registrations. Existing `.data/core/` was upgraded with additive migration 002; it was never reset. Soft deletion hides trip resources and invitation access while retaining financial/audit records.

## Preview and reproduction

The preview is running at <http://127.0.0.1:3000>, with the core and discovery on loopback ports 4000 and 4100. To restart:

```powershell
npm run setup:discovery
npm run dev:local
```

Open the landing or Explore page publicly. Choose My Trips and the labelled Aman local account, create a trip, then use its Plan, Saved places, Budget, People and Settings views. Invitation links can be tried with Riya; Aman approves her request. Dev exercises outsider denial. Restarting the launcher rotates the local session secret, requiring sign-in again; saved trips persist.

## Contributions and implementation choices

- Coordinator: architecture/contract and reference review; original Three.js engine, reusable Tubes wrapper and sticky story; root launcher, dependencies, CI, service setup, integration script, documentation and final integration.
- Core creator: additive migration, compatible trip management, activity ordering/version conflicts, saved snapshots, audited paid expenses, authoritative budgets and database/access regression tests.
- Website creator: modular routes, shell/auth, trips, forms, itinerary, discovery, saved places, budget, people/settings, responsive brand styling and UI validation.
- Discovery creator: real independent Python API, reviewed official-source catalogue, pinned environment, web discovery BFF and service/proxy tests.
- Independent verifier: separate source/test/API review, eight adversarial HTTP groups, findings and [acceptance report](../verification/02-premium-planner.md). The verifier did not author feature code.

The supplied marketplace reference and npm `threejs-components` API were inspected before choosing the original installed-Three implementation. The inspected reference wrapper had listener-cleanup and fixed-DPR behavior that conflicted with the owner's requirements. No marketplace code was copied or purchased and no CDN module is required. The [visual decision](../decisions/2026-10-21-premium-visuals.md) records sources, versions and lifecycle details. No new image service or paid animation dependency was added.

## Actual verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass for web and core; independently repeated. |
| `npm test` | Pass: 12 web and 31 core reported cases, including retained private-trip/security tests. |
| `npm run test:discovery` | Pass: 28 Python tests against the real FastAPI application. |
| `npm run build` | Pass: production Next.js 16.4.2 and core TypeScript build after the final feature changes. |
| `npm run verify:planner` | Pass: eight groups through actual local web BFF, core, database and Python discovery, on the final runtime. |
| `node scripts/independent-planner.mjs` | Pass: eight independent groups on the final runtime; final live regressions included. |
| Source review | Brand/motion fallback, lifecycle ownership, labelled controls, auth boundaries, no credential console logs/public secret variables/browser token storage in application source. |
| Lint | No lint command is configured; no lint pass is claimed. |
| Rendered desktop/mobile, GPU, scroll, keyboard and browser console | Not tested: existing browser security-policy denial prohibited inspection; no alternate surface/workaround was attempted. |
| Cognito email/account flow, deployed PostgreSQL, AWS/Vercel | Not tested: integrations/account and cost gates remain unconfigured. |

The integrated checks cover create/edit/reopen, activity CRUD/order/day movement/date/version validation, explicit place saving/scheduling, exact budget examples, expense permissions and removal/outsider/deletion isolation. The independent supplement additionally checks simultaneous stale edits, foreign-trip reorder atomicity, one-paise/seven-person rounding, historical removed-payer correction and rejection of credentials in source links. Both findings from the baseline were fixed and live-retested. Fixtures are synthetic; new planner scripts soft-delete their own trips without clearing existing data. Database tests separately verify close/reopen persistence and repeat-safe migrations.

Source/build checks do not prove scroll smoothness, layout at 320–1440px, WebGL allocation/leak behavior, contrast, keyboard usability or browser runtime logs. The owner's old-preview availability confirmation predates this implementation and is not counted as new visual acceptance.

## Cost and remaining gates

No AWS resource, account upgrade, budget alert, tile subscription, public signup or cloud deployment was created. Incremental provisioned cloud cost is zero; existing account costs were not audited. The latest owner-reported AWS balance is US$100 remaining on Free Plan; expiry and allowed configurations still need verification before provisioning. See [Stage 0](../stage-0.md).

The local product is ready for owner review. Remaining acceptance work is permitted rendered desktop/phone/reduced-motion/GPU/keyboard review, followed by the already-documented AWS account/cost and real Cognito/Vercel development-preview gates. Existing auth limitations (including MFA/custom challenges, rotation, resend/change-password/account deletion and a process-local limiter) remain recorded in `apps/web/README.md`; no new fake success path was introduced. Future map/tile, live events/business data, financial splits/repayments and document features remain separate delivery stages.
