"""Independently runnable, public-only FastAPI discovery service."""

from typing import Annotated
import asyncio

from fastapi import FastAPI, HTTPException, Path, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .catalogue import BY_ID, CATALOGUE, PLACES, PlaceDetail, PlaceResults, search_places
from .place_search import SearchResults, search_all

app = FastAPI(title="Goa Together public discovery", version="1.0.0", docs_url=None, redoc_url=None)
PUBLIC_CACHE = "public, max-age=300"


def error_response(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers={"Cache-Control": "no-store"})


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, _error: RequestValidationError) -> JSONResponse:
    return error_response("VALIDATION_ERROR", "Use a search of at most 80 characters and a supported category or Goa region.", 400)


@app.exception_handler(StarletteHTTPException)
async def http_error(_request: Request, error: StarletteHTTPException) -> JSONResponse:
    if error.status_code == 404:
        return error_response("NOT_FOUND", "This place or discovery route was not found.", 404)
    if error.status_code == 405:
        response = error_response("METHOD_NOT_ALLOWED", "Discovery is read-only.", 405)
        response.headers.update(error.headers or {})
        return response
    return error_response("VALIDATION_ERROR", str(error.detail), error.status_code)


@app.get("/health")
async def health(response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return {"status": "ok", "catalogueCount": len(PLACES)}


@app.get("/v1/places", response_model=PlaceResults)
async def places(
    request: Request,
    response: Response,
    q: Annotated[str, Query(max_length=80)] = "",
    category: Annotated[str | None, Query(pattern=r"^(?:beach|food|cafe|nightlife|culture|adventure|shopping|transport|other)?$")] = None,
    region: Annotated[str | None, Query(pattern=r"^(?:north|south|central|all)?$")] = None,
) -> PlaceResults:
    keys = list(request.query_params.keys())
    if (
        any(key not in {"q", "category", "region"} for key in keys)
        or any(len(request.query_params.getlist(key)) > 1 for key in keys)
        or any(ord(character) < 32 or ord(character) == 127 for character in q)
    ):
        raise HTTPException(400, "Use only one value for each supported filter, with no control characters.")
    matches = search_places(q, category, region)
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return PlaceResults(places=matches, total=len(matches), catalogue=CATALOGUE)


@app.get("/v1/places/{place_id}", response_model=PlaceDetail)
async def place_detail(
    request: Request,
    response: Response,
    place_id: Annotated[str, Path(max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")],
) -> PlaceDetail:
    if request.query_params:
        raise HTTPException(400, "Place details do not accept query filters.")
    place = BY_ID.get(place_id)
    if place is None:
        raise HTTPException(404)
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return PlaceDetail(place=place)


@app.get("/v1/search", response_model=SearchResults)
async def map_search(request: Request, response: Response,
    q: Annotated[str, Query(min_length=3, max_length=80)],
    category: Annotated[str | None, Query(pattern=r"^(?:beach|food|cafe|nightlife|culture|adventure|shopping|transport|other)?$")] = None,
    region: Annotated[str | None, Query(pattern=r"^(?:north|south|central|all)?$")] = None,
) -> SearchResults:
    keys = list(request.query_params.keys())
    if len(q.strip()) < 3 or any(ord(char) < 32 or ord(char) == 127 for char in q) or any(key not in {"q", "category", "region"} or len(request.query_params.getlist(key)) != 1 for key in keys):
        raise HTTPException(400, "Use one bounded place query and supported filters.")
    result = await asyncio.to_thread(search_all, q, category, region)
    response.headers["Cache-Control"] = "public, max-age=30" if result.providerAvailable else "no-store"
    return result
