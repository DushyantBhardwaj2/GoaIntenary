# Slice 06 — shared-expense workspace

21 October 2026. The owner wants Budget & splits to work like a focused Splitwise-style group wallet, using Spliito as a product reference. Replace the oversized forecast-first page with a compact expense-first workspace in the existing private trip route.

Input: current authorised trip, budget, expense participants and ledger. Output: searchable dated expense feed, exact saved split details, personal balance/share summary, visible group balances, selected-person expense entry, guest management and prefilled manual repayment records. Separate Expenses, Settle up and Budget views keep forecasts available. The primary example remains a ₹4,000 bill paid by Aman for four selected travellers in a larger group; only those four receive stored ₹1,000 shares.

Core API remains the data/calculation owner. Reuse existing budget, ledger, expense, participant and repayment endpoints without migrations or balance-algorithm changes. Preserve versioned edits, idempotency, outsider denial, guest/member separation, unallocated historical bills and organiser-confirmed corrections after repayment. Suggestions do not transfer money; record a payment only after it was made externally. Failures remain visible with retry and no fake successful saves.

Design: Goa green/ivory/coral, compact sans-serif finance information, small editorial title, date/category markers, restrained borders, responsive single-column phone layout and scoped CSS to prevent global label rules stretching controls. All search, view, add/edit/delete, guest/archive and repayment controls perform actual actions. No new dependencies or reference-site assets/source.

Acceptance: expenses and balances immediately discoverable; search and personal/unallocated filters; selected members/guests and exact shares preserved; per-pair settlement action prefills the permitted payer, recipient and amount; partial payments supported; budget forecasts retained separately. Run web typecheck/tests/production build and the live selected-splits regression suite. Rendered desktop/mobile/keyboard/console checks remain blocked by the existing browser-security denial, and must not be claimed as passed.

Reference capture and adaptation: [DESIGN.md](../../DESIGN.md).
