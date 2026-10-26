---
name: goa-expenses
description: Implement or verify the Goa group's INR expense splitter, budgets, repayments, and settlement arithmetic. Use whenever money calculations or financial records change.
---

# Expense ledger

Read sections 4.6 and 14 of [plan.md](../../plan.md). Monetary values use integer paise or exact decimal. An expense has one payer and selected beneficiaries in the pilot. Store the allocated share per person; custom shares must sum exactly to the expense amount. Equal splits distribute leftover paise deterministically. The payer may be outside the beneficiary set.

Per member, balance equals **expenses paid − expense shares + repayments sent − repayments received**. Positive means they should receive; negative means they owe. The total of all member balances is zero. Repayments do not increase trip spending. An activity estimate changes forecast budget only. A late joiner does not inherit previous shares, and removing a member does not erase history.

Test the ₹4,000 four-person example, excluded participants, uneven paise, custom split totals, partial repayment, multiple payers via separate expenses, edits, removed members, and duplicate submissions. Preserve an audit trail; changing an expense after settlement needs an explicit correction path. The balance algorithm is owned by the core API, and the frontend displays its result rather than independently computing a competing ledger.
