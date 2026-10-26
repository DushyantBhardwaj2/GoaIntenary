# Discovery slice verification — 21 October 2026

Creator handoff for `services/discovery/**` and `apps/web/src/app/api/discovery/**`. This is executable service/BFF verification, not rendered-browser or independent product acceptance.

## Changes and ownership

The Python API owns a versioned public read-only catalogue of 16 reviewed places and bounded text/category/region filtering. A source, ISO review timestamp, region, area and approximate pin accompany every place. Private trip creation, saving, scheduling and budgets remain owned by the TypeScript core; this service does not open a database connection or accept a user identity. The website BFF permits only `/places` and `/places/:id`, forwards no browser credentials, and returns retryable errors without placeholder results when discovery is unavailable.

The input, output, owner, security and failure contract was agreed in `docs/slices/02-premium-planner.md` before this implementation. The existing Next route-handler guide was read from the installed `node_modules/next/dist/docs` before the BFF edit, including asynchronous route params and request-time caching. Current [FastAPI Query validation](https://fastapi.tiangolo.com/tutorial/query-params-str-validations/) and [official testing documentation](https://github.com/fastapi/fastapi/blob/8ee0e7e96baf68a02212199d0d64153945b701ba/docs/en/docs/tutorial/testing.md) were checked; pinned versions were read from public PyPI and installed in a service-local environment. Installed Starlette now recommends HTTPX2 for TestClient; this implementation uses that supported client rather than its deprecated HTTPX fallback.

## Results actually run

| Check | Result |
| --- | --- |
| Python `.venv/Scripts/python.exe -m pytest -q` | **28 passed in 1.49s**, no warnings, using real FastAPI TestClient |
| Website `tsx --test apps/web/src/app/api/discovery/proxy.test.ts` | **6 passed**, no failures |
| Python `compileall -q app` | Passed |
| Python `pip check` | No broken requirements |
| Live Uvicorn `/health` | 200, `status:ok`, count 16 |
| Live `GET /v1/places` | 200, count 16 |
| Live south + beach filter | 200, count 3 |
| Live `q=Palolem` | 200, count 1 |
| Live Palolem detail | 200, stable `palolem-beach` ID |
| Live invalid region | 400 `VALIDATION_ERROR` |
| Live unknown detail and private `/v1/trips` | Both 404 `NOT_FOUND` |
| Smoke-server shutdown | Port 4100 released, confirmed by failed subsequent local fetch |

Python checks cover case-insensitive/multiword search, blank filters, empty matches, combined category/region filters, invalid/duplicate/unknown/oversized queries, exact detail schema, unique IDs, HTTPS official sources, explicit UTC review dates, bounded Goa coordinates, no private routes and no write endpoints. BFF checks cover the allowlist, bounded filters, credential isolation, details, upstream 400/404 preservation, offline/500/invalid JSON/non-JSON failures and invalid configured URL schemes. Both creator-authored suites are useful regression checks; independent verification remains separate.

The first sandboxed TestClient attempt hung while Windows Python was creating its asyncio local socketpair. A five-second diagnostic traceback identified `socket.socketpair` rather than application code. Those attempts were stopped. The successful tests and live loopback smoke used approved local-network execution. The temporary Uvicorn process was stopped before handing the port back to the integrated launcher.

## Limits

This catalogue covers beaches and heritage. Other available filter categories currently have no reviewed entries. Pins are approximate manual annotations; source review does not certify entrance coordinates. Source information is an editorial snapshot, not live hours, safety, operating status, availability, ratings or booking inventory. No commercial photos, external image dependencies, provider keys, subscription or cloud resource was introduced. No personal or private trip records were accessed. No rendered-browser, mobile, scrolling, map-placement, keyboard or animation claim follows from these checks; those belong to the integrated website verification.

All source URLs and coordinate context are listed in [README.md](README.md).
