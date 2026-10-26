# Goa Together — expense workspace reference

## Reference and capture

Owner supplied https://spliito.com/ and a screenshot of Goa Together's current Budget & splits page. Firecrawl retrieved Spliito's public homepage text and branding on 21 October 2026. Its text describes recording who paid, how much, for whom, then checking settlement suggestions. Those common expense-tool workflows inform this slice. The retrieved page includes a restriction on cloning its design/source; this implementation uses original Goa components, copy and styling and reuses no Spliito assets or source.

A screenshot URL was returned but its pixels were not inspected. Direct web access to the tutorial image URLs failed. Therefore no reference layout dimensions, mobile behavior or pixel fidelity are asserted. The owner's local screenshot was inspected; it establishes the current oversized forecast cards and the expense/balance content buried below them.

## Implementation choices

These are proposed Goa Together choices, not extracted Spliito CSS values:

- Existing green `#173F35`, forest `#245B49`, ivory `#F7F4EB`, white `#FFFEFA`, coral `#DE6C4E`, sea glass `#91AAA0`, sand `#E8D9B4` and secondary text `#687C75`.
- Existing DM Sans and DM Serif Display; reserve serif for a compact page title. Amounts use tabular numerals and explicit receive/owe labels in addition to color.
- Header: Trip expenses, participant count/currency, Add expense and Settle up. Three concise summaries show personal net balance, total paid spending and the member's saved shares.
- Main column: Expenses, Settle up and Budget view controls; searchable dated expense rows with payer, participant count and personal share. Expand a row for exact stored allocations and edit/delete actions.
- Side column: individual balances, member/guest labels and organiser guest controls. Phones use one column, full-width controls and comfortable targets.
- Settlement view: payer-to-recipient suggestions with prefilled payment-record actions and real repayment history. Budget view: remaining budget, estimate totals and category breakdown; estimates never become debts.
- Scoped styles prevent broad global label/input rules from stretching controls. Native details/dialog semantics, visible labels/focus, explicit repayment confirmation and reduced-motion support.

## Images and unresolved verification

No imagery is needed for this financial workspace. Use existing Lucide symbols and text initials. No remote image dependency or reference assets are introduced. Actual rendered desktop/mobile/keyboard/console acceptance remains open under the prior browser-security policy; build/API verification is separate evidence.

## Concept mockups

These generated images show possible desktop and mobile layouts. They are design references, not screenshots or implementation verification:

- [Trip overview](docs/design/trip-overview-concept.png)
- [Itinerary](docs/design/itinerary-concept.png)
- [Members](docs/design/members-concept.png)
- [Notes and to-dos](docs/design/notes-todo-concept.png)
- [Expense workspace](docs/design/expense-workspace-concept.png)

The Notes concept uses a to-do list. Each shared item shows its creator separately from its assignee or completion actor. Personal items are visible only to their owner. The mockup does not change the current application behavior.
