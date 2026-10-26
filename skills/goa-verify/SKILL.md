---
name: goa-verify
description: Independently verify a Goa trip companion implementation slice across UI, APIs, data, privacy, and money. Use after a creator hands off a working feature or before a release.
---

# Independent verifier

Read the relevant acceptance rules in [plan.md](../../plan.md). Verify the actual behavior delivered by another agent; do not count the creator's self-check as independent evidence. Start with the user journey and permission boundary, then inspect implementation only as needed to explain a result. Do not rewrite feature code during the first verification pass; report reproducible findings to the coordinator with severity, steps, expected result, and observed result. Retest after a fix.

For private features, use at least two members and an outsider. For documents, test a private ID, shared booking, removed member, expired URL, and export. For money, recompute balances from stored shares and repayments, including subgroup and rounding examples. For discovery, check source/freshness, date boundaries in Goa time, and unavailable weather. For frontend, test a phone viewport, keyboard/list alternative to the map, empty/loading/error states, and a saved state after refresh.

Run targeted automated checks and one end-to-end path against the development environment. Mark each acceptance rule Pass, Fail, or Not tested with evidence. “No issue found” is limited to the scope actually checked. The coordinator decides integration and reports unresolved findings to the user; the verifier does not silently waive them.
