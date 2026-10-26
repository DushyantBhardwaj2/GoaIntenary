---
name: goa-orchestrate
description: Coordinate multiple subagents building the Goa trip companion across frontend, TypeScript API, Python service, AWS/Vercel, and independent verification. Use for staged implementation or cross-service changes in this project.
---

# Coordinate the Goa build

Read [plan.md](../../plan.md) and [agent.md](../../agent.md), identify the current stage, and define one end-to-end outcome before delegating. The root agent owns integration, user communication, scope, and the final result. Subagents own bounded work; they do not independently redefine the product or send external messages.

Create a task contract for each subagent: objective, files or service owned, inputs and expected API/event contract, acceptance checks, and handoff. Assign disjoint writable paths whenever agents work simultaneously. Agree on shared contracts before parallel edits. Do not spawn agents just to appear busy.

This host allows four active agents including the root, so run at most three children concurrently. A useful first wave may include web, core API, and Python discovery. Bring in a security or platform specialist when its work is ready; run the independent verifier after a slice is integrated. Keep the verifier separate from the feature author for the same slice.

If subagent tools are unavailable in a later session, state that limitation and work through the same responsibilities sequentially. Never fabricate parallel work or imply that an unassigned agent has checked a feature.

The coordinator checks progress and blockers, resolves interface mismatches, integrates changes, runs the end-to-end flow, and confirms that verification findings were fixed or explicitly recorded. A subagent saying “done” is a handoff, not proof that the product flow works. Finish each stage with changed behavior, tests, preview or local run evidence, cost impact, and remaining risk. If the user changes scope, reassign work and update the plan.
