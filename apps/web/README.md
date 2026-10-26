# Goa web

Next.js App Router frontend and same-origin backend for frontend. Run through the root launcher so core and web share the local signing secret. The implemented slices cover the public editorial landing, source-backed Goa discovery and Leaflet map, private trip management, manually ordered activities/day pins, saved places, INR budget, selected-person equal/custom splits, named guests, debt balances, advisory settlements and manual external repayment records. Invitations, approval and removal retain server-side permissions. No money is transferred; documents and booking/payment integrations remain later work.

## Local routes and checks

- `/` — public editorial landing, decorative lazy Three.js effect with static fallback, sticky story and explicitly illustrative inspiration.
- `/auth` — email account entry and explicitly labelled local review accounts; safe allowlisted `next` destinations preserve private-trip or explore context.
- `/trips` — accepted trips, search/sort, and three-step private trip creation.
- `/explore` — shared map/list search, source-labelled reviewed/Photon results, keyboard suggestions, pin focus and explicit add-to-itinerary/save-for-later actions with a trip selector.
- `/trips/:tripId` — accepted member workspace with Plan, Saved places, Budget & splits and People. Manual add/edit/move/up-down ordering and unscheduled ideas use persistent versioned APIs. Day pins retain activity numbers, skipping text-only stops. Organisers manage settings/deletion, guests, invitations, approvals, revocation and removal.
- `/join#token=...` — private invitation entry. The fragment is read into memory and immediately removed from the address bar; it never enters a server URL or browser storage. Authentication happens inline so this memory survives sign-in. Reopen the original link if the page is reloaded before joining.
- `/api/auth/status` — `{configured,localAvailable,hasSession}`; identity is verified by `/api/core/v1/me`.
- `/api/auth/{local,login,register,confirm,forgot,reset,refresh,logout}` — POST, exact Origin required.
- `/api/core/v1/...` — authenticated proxy to core. No identity or role is accepted from browser headers.

`npm run typecheck --workspace @goa/web`, `npm run test --workspace @goa/web`, `npm run build --workspace @goa/web`.

Planner unit checks cover exact decimal INR parsing, malformed inputs, leap-day date ranges and overlap warnings. The UI consumes authoritative server budget totals, keeps estimates separate from paid spending, and labels per-traveller numbers as approximate averages, never debts. Expense edits preserve a historical payer who has since been removed.

Split forms explicitly select beneficiaries, including guests; they default to the signed-in traveller rather than silently charging the whole trip. Draft shares are previews, while saved shares and balances come from core. Legacy unsplit bills remain outside balances. Repayment-aware expense corrections require an organiser confirmation and keep repayment history. Guests never gain sign-in or trip-read rights and are not automatically merged with a later joined account.

Leaflet 1.9.4 is dynamically imported inside a client effect with cancellation, map removal and ResizeObserver cleanup. Text labels use DOM textContent; no place title becomes raw HTML. Standard OSM tile image requests use `referrerPolicy: origin`, overriding the site's no-referrer default only for tiles, so no private trip path/invitation is sent. Browser caching/visible attribution are preserved. There is no tile prefetch, offline feature or server proxy. Map projection tests check filtered sets, missing coordinates and original itinerary numbering; actual browser tiles/keyboard/layout remain untested under the existing policy restriction.

Map search uses an 800ms debounce, AbortController/stale-response guards, labelled source results and a keyboard-selectable combobox. Explore shares one search state across the map and cards; the private planner keeps day pins and adds S-labelled search pins. Layer/selection changes do not reinitialise the map. `PlacePlanDialog` chooses an accepted trip or uses the current private trip; `ActivityForm` confirms day/details and persists source notes/coordinates using the existing API. A successful search alone performs no private write. See [Slice 04](../../docs/slices/04-handoff.md) for actual test/provider evidence and browser limits.

Security unit checks cover exact Origin (including absent and mismatching Origin), forwarded-host rejection for local entry, production local-mode rejection, unsafe navigation paths, and byte-bounded request streams without Content-Length. Public discovery proxy tests additionally cover filters, route allowlists and unavailable responses. Backend permission tests and live BFF/browser checks are separate; passing these unit checks alone does not prove the full journey.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CORE_API_URL` | Server-only upstream; defaults to `http://127.0.0.1:4000`. |
| `COGNITO_REGION` | Actual Cognito pool region, for example `ap-south-1` after the cloud gate. |
| `COGNITO_CLIENT_ID` | Public Cognito user pool app client ID. Never supply a client secret here. |
| `APP_ORIGIN` | Exact public HTTPS origin in hosted environments, including a port when applicable. No trailing slash. The local default uses the request scheme and Host. |
| `ENABLE_LOCAL_DEMO` | Literal `true` enables synthetic entry only in development with a loopback Host. |
| `LOCAL_SESSION_SECRET` | Shared random secret of at least 32 characters, generated by the root local launcher. Never commit it. |

Local accounts require `NODE_ENV != production`, no Lambda runtime, and Host exactly `localhost` or `127.0.0.1` (optional port). Forwarded hosts never grant local entry. Bind the local server to loopback. These identities are synthetic `{aman,riya,dev}@example.invalid`; no passwords or Cognito accounts are created. Trips are persisted by core, not by the browser.

## Actual Cognito requirements and limitations

Use a user pool app client **without a client secret**, email sign-in and verification, `ALLOW_USER_PASSWORD_AUTH`, and `ALLOW_REFRESH_TOKEN_AUTH`. The integration uses SDK v3 `SignUp`, `ConfirmSignUp`, `InitiateAuth`, `ForgotPassword`, `ConfirmForgotPassword`, and `GlobalSignOut`. Password rules remain authoritative in Cognito. Core additionally needs its own configured pool ID/client ID and verifies the access token; setting web variables alone does not configure core.

Access and refresh tokens are HTTP-only cookies, SameSite=Lax, Secure in production. The access cookie follows Cognito's `ExpiresIn`; the refresh cookie is capped at 30 days locally and Cognito still enforces the actual client expiry. On an expired access session the client makes a same-origin POST refresh and retries core once. This implementation supports **non-rotating** Cognito refresh tokens. Refresh token rotation requires the separate Cognito refresh API before enabling it. Additional auth challenges (MFA, forced password changes, custom challenges), change password, account deletion/retention, and resend-verification-code UI are not implemented in this slice. Global sign-out is attempted; browser cookies are always cleared even if Cognito is unavailable.

Auth attempts have a process-local bounded limiter. A hosted public signup release still needs a distributed/edge limiter and actual Cognito email delivery checks. Account flows have not been tested against a real Cognito pool until such evidence is recorded by the coordinator. Missing setup is shown explicitly; the UI never reports registration success without a successful Cognito response. No token, password, invitation link, cookie, or complete authentication request is logged by application code.

Auth bodies are stream-limited to 8 KiB; core request bodies to 16 KiB. Mutations require an exact Origin; private API responses are `no-store`. Invite raw tokens appear once in component memory and user-requested clipboard copies. The database stores their hash. Pending users see an approval state without trip content.

## Official references checked

- [Next.js async cookies](https://nextjs.org/docs/app/api-reference/functions/cookies)
- [Next.js Route Handler methods and promised params](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- [Cognito identity provider SDK v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/cognito-identity-provider/)
- [React effect lifecycle and cleanup](https://react.dev/reference/react/useEffect)

The desktop typography requests DM Sans and DM Serif Display from Google Fonts, with local fallbacks. The coastal artwork is original SVG/CSS and has no external image dependency. Reduced-motion settings disable decorative animation. Native modal dialogs provide focus trapping, Escape cancellation and focus restoration.

No rendered browser, phone viewport, animation or GPU checks are claimed: the browser tool policy blocked inspection in this session. CSS includes 320px layouts, visible focus, readable body text and touch controls, while the coordinator owns visual module teardown and integrated validation. Catalogue entries are a reviewed snapshot, not live inventory, and every place exposes its source and check date.
