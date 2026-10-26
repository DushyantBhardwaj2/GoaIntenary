---
name: goa-discovery
description: Build the Python Goa place and event discovery API and background handlers for freshness, weather, reminders, and document jobs. Use for public content and Python asynchronous workloads.
---

# Goa discovery and jobs

Read sections 4.1–4.2, 14–17 of [plan.md](../../plan.md). Own reviewed place records, amenities, dated events, area search, source and freshness labels, and weather cache. Provide public search and detail endpoints plus explicit content-admin writes. Do not read private trip data merely because a content administrator account exists.

For events, distinguish a scheduled event from live availability. Store start/end with timezone; Today and Tonight use Goa local time. Expired events leave current results while admin history remains. Use published sources and permitted content; do not invent prices, hours, or party listings. A weather response includes provider, area, last updated time, and an unavailable state beyond the forecast window.

Python workers may process uploads, reminders, and cleanup through queues/schedules. Messages should carry minimal IDs and safe context. Expect retries: define idempotency keys or unique outcomes, visible failure state, and a replay method. Share an API/event contract with the TypeScript owner rather than writing directly into its tables without an agreed limited interface. Test date boundaries, stale content, duplicate messages, and failure recovery. Handoff includes source/freshness assumptions and any provider costs or usage limits.
