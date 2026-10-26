---
name: goa-core-api
description: Implement the Goa trip companion's TypeScript Fastify core API for private trips, membership, itinerary, bookings, and shared records. Use for core domain endpoints and contracts, excluding public discovery ingestion.
---

# Core trip API

Read sections 13–16 of [plan.md](../../plan.md) and the service rules in [agent.md](../../agent.md). The core service owns private trip state: profiles linked to Cognito, memberships, invitations, activities, votes, comments, bookings, expense records, checklists, and document authorization. Keep modules together within the TypeScript service for the pilot.

For each endpoint, define the authenticated actor, trip scope, allowed roles, validation, transaction boundary, idempotency behavior, and error response before implementation. Derive identity from verified auth, never from a browser-supplied user ID. Non-members cannot infer private trip or file existence. Membership removal blocks new trip reads and new file grants while preserving historical ledger records.

Use database constraints and transactions for operations that must move together, such as invitation acceptance, expense plus shares, and document status. Coordinate schema ownership and API contracts with Python and web agents. Keep public catalogue/event editing in the discovery service. Test the successful path and at least one forbidden, duplicate, and failed/retry path for each sensitive write. Report actual routes, migration changes, and verification results at handoff.
