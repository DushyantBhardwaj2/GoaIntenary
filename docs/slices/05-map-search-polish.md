# Slice 05 — map search layout correction

21 October 2026. Owner screenshot shows the search icon, accessible label, input and clear button stacked vertically, stretching both the field and submit button. Root causes: the field wrapper is a label inheriting global `flex-direction:column`, and global `label > span {display:contents}` defeats the hidden-label box.

Replace that wrapper with a dedicated horizontal input container and an explicit associated label. Isolate sizing/flex/grid styles in the map CSS module, give clear/submit controls comfortable targets, tighten spacing and shorten inline metadata while keeping source/failure information available. Desktop search stays one compact row; narrow phones can stack a regular-height submit button. Preserve search, result selection, map focus, itinerary actions and all persistence/auth rules. No API, financial or database change.

Acceptance: compact search field/button, no visible hidden-label text, map gets the main space, readable results/selected actions, safe mobile layout. Verify TypeScript/production build; rendered checks remain blocked by the existing browser policy. The supplied screenshot was inspected; it is evidence of the original defect, not the corrected rendering.

Implemented: explicit visible input label outside the field wrapper, isolated grid/flex sizing (52px desktop controls, 46px phone submit), 44px clear target, stronger focus treatment, compact pin-count badge/reset control, taller map and shorter inline help. Full provider/source explanation stays under About these places; provider failures remain visible. Search, results, map focus and save handlers are unchanged.

Verification: `npm run typecheck --workspace @goa/web` and `npm run build --workspace @goa/web` both passed. No new tests were written for this reversible styling correction. The existing local preview remains running; no API restart/session rotation or data migration was required. Corrected rendered appearance remains Not tested under the prior browser restriction.
