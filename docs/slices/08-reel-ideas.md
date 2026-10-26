# Slice 08 — Reel and photo ideas

## Journey and acceptance

An accepted member opens **Reel** in a private trip, adds a title, chooses Reel or Photo, pastes an optional Instagram reference, selects one or more accepted members, and optionally describes the place and shot. Save persists the idea for the group across refreshes. Members can reopen the Instagram reference; the creator or organiser can edit or remove an idea. Example: “Sunset transition”, Reel, an Instagram reel URL, Aman and Riya, “Palolem beach”, “Film just before sunset”.

The core API owns the records in PostgreSQL. The web uses the existing authenticated core proxy. Outsiders, pending and removed members cannot read or write ideas. Participant IDs must belong to accepted members in the same trip. URLs permit only HTTPS Instagram hosts, no credentials or nonstandard ports; links open externally with safe rel attributes. No Instagram credentials, scraping, embedding or upload integration is required.

## API v1

- `GET /v1/trips/:tripId/reel-ideas` → `{ ideas: ReelIdea[] }`.
- `POST /v1/trips/:tripId/reel-ideas` with `Idempotency-Key` → 201 `{ idea: ReelIdea }`.
- `PATCH /v1/trips/:tripId/reel-ideas/:ideaId` with full input and `version` → `{ idea: ReelIdea }`; stale version → 409.
- `DELETE /v1/trips/:tripId/reel-ideas/:ideaId` → 204, creator or organiser only; an authorised replay is also 204 without another audit entry.

`ReelIdeaInput = { title: string (1–160), kind: 'reel' | 'photo', instagramUrl: string | null (max 2048), location: string (max 200), notes: string (max 4000), participantUserIds: string[] (1–100 unique accepted member UUIDs) }`.

`ReelIdea` adds `id`, `tripId`, `createdBy`, `createdAt`, `updatedAt` (UTC ISO strings) and integer `version` starting at 1. IDs are UUIDs. Reads return newest first. Participant IDs are sorted and deduplicated during normalization; malformed input, unsupported URL and invalid participants return 400; inaccessible records return 404; unauthenticated callers return 401; non-creator/non-organiser mutations return 403. Failed saves preserve form values and retry keys. Writes and audit entries are transactional.

## Migration and verification

Migration 005 adds the trip-scoped idea and selected-member records; no backfill or destructive changes. Prior web/API versions ignore the new tables. Deploy migration before the core, then web; rollback application code can leave the additive tables intact. No new infrastructure or third-party subscriptions.

Verify creation, cross-member visibility, update, deletion, fresh database connection persistence, forbidden membership and mutation paths, unsafe URLs, cross-trip participant rejection, and duplicate/retry behavior. Check the rendered form and saved card at phone and desktop sizes, including keyboard labels and failed saves.

## Delivery status — 26 October 2026

Implemented locally, with **Reel** in desktop trip navigation and first in the phone's **More on this trip** menu. The panel includes Reel/Photo filters, selected-person chips, empty/loading/error feedback, safe external links and creator/organiser controls. Failed saves preserve form values and the create retry key; stale edits preserve entered text and explain how to reload. Former participants receive fallback labels and are excluded from new edit selections with a visible notice.

Validation passed: core typecheck/build and all **117 core tests**; web typecheck, all **15 web tests** and production build; **five Reel HTTP groups** through the real Next.js cookie-session proxy and core API. Run `GOA_WEB_URL=http://127.0.0.1:3200 npm run verify:reel-ideas` against a local synthetic environment (set the environment variable using the host shell). The HTTP test refuses non-loopback URLs and requires the local-account flag before creating synthetic data.

The HTTP run used an ignored isolated web source copy, ports 3200/4200/4300 and `.data/reel-browser`; the user's existing port-3000 app and database were left running. The production build used the actual `apps/web` source. Independent review and a separate targeted nine-test run checked the implementation; its deletion retry finding was fixed and covered by the final core and HTTP suites.

Rendered phone/desktop, keyboard and offline-save browser acceptance remain **not tested**: the in-app browser timed out attaching to the local page, and the native browser app approval timed out. These limits do not invalidate the passing HTTP/database checks. No cloud migration, AWS/Vercel deployment or production data changes were made. Migration 005 and the core API must be released before the web feature becomes usable on the live website.
