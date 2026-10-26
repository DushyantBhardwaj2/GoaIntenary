---
name: goa-web
description: Build and review the Goa trip companion's mobile-first Next.js frontend on Vercel, including maps, trip planning, expenses, documents, and clear states. Use for frontend slices, not AWS domain logic.
---

# Goa web experience

Read the relevant screen and journey sections of [plan.md](../../plan.md) before editing. Work in `apps/web/` once that path exists. The frontend owns presentation, input, navigation, accessible alternatives, and client-to-API interaction. It does not decide membership, calculate authoritative balances, or expose AWS secrets.

Deliver one complete user action per slice: for example, choose a map pin, assign a day, save, refresh, and see the same activity in the timeline. Design for an ordinary phone first. Every map action needs a list or form route. Show loading, empty, validation, forbidden, offline/failed save, and retry states. Keep event freshness, weather timestamp, and document visibility clear to users.

Coordinate request/response shapes with the API owner before building a form around them. Do not create fake successful UI flows that have no persistence. Use current installed framework documentation and established repo patterns. Check keyboard access, labels, touch targets, responsive layout, and a browser journey against development services. Handoff includes a preview or exact local route, supported flows, and any API dependency still missing.
