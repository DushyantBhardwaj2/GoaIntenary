# Goa Together public discovery

An independently runnable Python FastAPI service owns this slice's public place catalogue. It never receives account tokens, reads private trip records or writes to the core database. The website's public BFF calls it at `/api/discovery/places` and `/api/discovery/places/:id`.

## Run locally

Python 3.11 is required. From this directory in PowerShell:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-lock.txt --cache-dir .cache/pip
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 4100
```

The checked-in lock records all packages actually installed and tested. `requirements.txt` lists the four direct dependencies. There are no API keys, subscriptions, database credentials or cloud resources. `.venv`, package cache and test cache are ignored. The repository launcher may start this command itself; do not start a second copy on port 4100.

Windows Python creates a local socketpair when it initializes its asyncio event loop. A sandbox that blocks loopback sockets can make even in-process `TestClient` calls wait indefinitely. Run the local server/tests with the environment's permitted loopback execution; this does not require an external service.

For a deployed website, set server-only `DISCOVERY_API_URL` to the deployed public discovery origin. Its default is `http://127.0.0.1:4100`. No browser session/cookie/header is forwarded to it. Production hosting is still unprovisioned.

## Contract v1

- `GET /health` returns `{status:"ok",catalogueCount:16}`; no cache.
- `GET /v1/places?q=&category=&region=` returns `{places:Place[],total,catalogue:{kind:"curated",checkedAt,notice}}`.
- `GET /v1/places/:id` returns `{place:Place}` or a stable `NOT_FOUND` 404.
- `GET /v1/search?q=&category=&region=` is the map-search extension, requiring 3–80 characters. It combines reviewed matches with source-labelled Goa Photon/OpenStreetMap results and explicit provider status; the original catalogue routes/record fields remain compatible.
- `Place` contains exactly `id,title,description,category,region,area,latitude,longitude,sourceUrl,checkedAt`.
- Place reads may be publicly cached for five minutes. Errors use `Cache-Control: no-store`.
- `q` searches all words, case-insensitively, in the title, area, description, category and region. Empty or whitespace-only search means all places. Maximum 80 Unicode code points; control characters are rejected.
- Categories: `beach,food,cafe,nightlife,culture,adventure,shopping,transport,other`. Regions: `north,south,central,all`; `all` only filters, never appears on a record. Empty category/region means no filter.
- Unsupported, duplicate or overlong filters return 400; unknown route/detail returns 404. The BFF additionally permits only the two documented place routes. It returns retryable 503 with `Retry-After: 30` if Python is down, times out, redirects or sends invalid data. There is no synthetic fallback.
- No private, content-admin, booking, weather, event or write routes are implemented. Food and other categories with no reviewed records return an honest empty list.

## Content and coordinate scope

`app/data/places.json` is a deliberately small, read-only, manually reviewed catalogue of 16 actual places. The source review date is 21 October 2026. The metadata and UI notice describe its limited coverage. It is not complete inventory, a booking system or a live business directory. The catalogue intentionally supplies no hours, ticket prices, availability, ratings, travel times or commercial promises.

Place identities and original short summaries were checked against the official Goa Tourism Development Corporation pages below. Public sources were read; no photographs or article text were copied into the app. Their full content is not stored. Pins are manually approximated editorial map locations, **not coordinates supplied or verified by GTDC, a geocoder or a site visit**. They must not be presented as entrances or navigation precision. `checkedAt` means the linked place information was reviewed, not that a venue, pin, opening time or road was verified in person. `central` is a convenient trip-planning region for Old Goa/Divar, not an administrative district designation.

| Reviewed official source | Records grounded in that source |
| --- | --- |
| [GTDC: Beaches of North Goa](https://goa-tourism.com/siteseeing/beaches-of-north-goa/) | Calangute, Baga, Candolim, Anjuna, Vagator, Morjim, Mandrem |
| [GTDC: Palolem](https://goa-tourism.com/beach/palolem/) | Palolem Beach |
| [GTDC: Colva Beach](https://goa-tourism.com/guide/colva-beach/) | Colva Beach and the mentioned Agonda Beach |
| [GTDC: Old Goa Heritage](https://goa-tourism.com/guide/old-goa-heritage/) | Basilica of Bom Jesus, Se Cathedral, Church and Convent of St Francis of Assisi, Viceroy's Arch, Divar Island, Archaeological Museum |

Source pages may contain historical/inconsistent transport or venue claims. These were excluded. For example, no beach-to-beach travel time, event schedule, operating-hour assertion or transport booking claim was imported. Before expanding the catalogue, review the primary source, replace the check date only after review and preserve stable IDs so saved trip snapshots remain usable. Future live providers, content-admin writes and broader region coverage require separate contracts.

## Dynamic map search extension

Under [Slice 04](../../docs/slices/04-map-search.md), `app/place_search.py` adds a bounded Photon adapter. When `PHOTON_API_URL` is unset, including on Lambda, discovery uses `https://photon.komoot.io/api/`. HTTPS is required except a self-hosted loopback HTTP endpoint. No credentials, query parameters or fragment are permitted in this endpoint configuration. No account/token/trip state is received or forwarded. The adapter has a five-second timeout, 128KiB body limit, maximum eight normalized provider results, thirty-minute/256-query cache, one-new-query-per-second shared limit, redirect rejection and failure cooldown. Streets, boundaries and the state itself are omitted. A private Photon-compatible endpoint can replace the public demo when capacity needs it.

Search uses a fixed Goa bounding box and validates returned Goa state/India country and coordinates. Public OSM feature IDs/URLs are generated from validated type/ID fields. Results expose `origin=reviewed|openstreetmap`; OSM timestamps mean retrieval, not independent review. No ratings/hours/availability are added. `Palom` is an input alias for reviewed Palolem. If Photon fails, the API explicitly reports that only matching reviewed results are shown. There is no fabricated fallback. See [final handoff](../../docs/slices/04-handoff.md) for 51 service tests, live provider checks, citations and remaining browser/cloud limits.

## Verification

```powershell
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m compileall -q app
.venv/Scripts/python.exe -m pip check
```

The website BFF has six executable tests, run from the repository root:

```powershell
node_modules/.bin/tsx --test apps/web/src/app/api/discovery/proxy.test.ts
```

See [verification.md](verification.md) for the actual results and limits.
