# Slice 06 handoff — trip expense workspace

Implemented locally on 21 October 2026. Existing trip `?tab=budget` now opens an expense-first group wallet. Original Goa palette/fonts and the working core ledger/data are retained. No new dependencies, migrations, cloud resources or deployments.

## Working behavior

- Compact summary: current member's server-returned net balance, recorded group spending, and saved personal share. Counts refer to actual active ledger participants, not the trip's declared headcount.
- Expenses view: title/category/payer/beneficiary search, All/Involving me/Not split yet filters, latest-first monthly groups, dated expense rows, current member share and expandable exact allocations. Authorised edit/delete actions retain version/correction protections.
- Add expense: one real payer, equal/custom/no-split choices, explicit people checkboxes, Select all/Clear, exact INR draft preview, member and guest labels. It still defaults only to the current member; nothing automatically splits across the whole group.
- Sidebar: actual receive/owe/settled balances with paid/share/repayment breakdown, organiser guest creation and guest archive controls. Guest and joined-user records remain separate and have unchanged permissions/history.
- Settle up: named payer-to-recipient suggestions and actual repayment history. A permitted row opens a prefilled payment-record dialog; changing people updates the amount cap. Partial payments work. Explicit confirmation is required; this records an external payment, never transfers money.
- Budget view: editable budget, remaining/over-budget amount, itinerary estimates, paid/planned categories and optional headcount averages. Estimates and repayments remain outside actual shared-bill spending.
- Isolated finance CSS includes phone/tablet layouts, normal-size checkbox/search controls, comfortable targets, clear focus and reduced-motion handling. Dialogs now have programmatic title labels and retain native modal/focus behavior.

## Verification actually run

| Check | Result |
| --- | --- |
| Web typecheck (`next typegen`, `tsc --noEmit`) | Passed |
| Existing web test suite | 15 passed |
| Production web build, Next 16.4.2 | Passed on final code. An intermediate rebuild hit Windows EPERM while creating generated `.next/server/app/auth.segments/auth`; rerunning with filesystem permission succeeded, without deleting data or stopping the preview. |
| Existing live `verify:splits` suite against real local services/BFF | All 8 groups passed: selected four-way shares, guests, excluded payer, custom validation, idempotency, partial repayments, correction/audit/access/history boundaries and forecast separation |
| Existing local trip budget HTML route | HTTP 200 after redesign; this is a server response check, not an interaction/visual check |
| React/component source review | Checked hooks, stable record keys, parallel independent reads, accessible input/button names, native details/dialog semantics, scoped form resets, unchanged server permissions and exact paise inputs |
| Rendered desktop/mobile, keyboard, browser console | Not tested: prior browser-security denial remains binding; no alternate UI surface or workaround attempted |
| Lint | No lint command configured in this workspace |

No new tests were added for this reversible presentation refactor. Existing financial and access regression coverage was rerun. Synthetic verification creates and soft-deletes only its own trip; other user records were not cleared. The existing local preview is still running at http://127.0.0.1:3000/. Cloud/Cognito/cost gates from earlier slices remain open.

Reference evidence and fidelity gaps are in [DESIGN.md](../../DESIGN.md). Spliito's public text supplied common workflow inspiration; its source/assets were not copied and no pixel-match claim is made.
