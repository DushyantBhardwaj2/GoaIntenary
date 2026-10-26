import io
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import place_search
from app.catalogue import normalize_query
from app.place_search import PhotonSearch, SearchUnavailable, normalise_features, search_all

NOW = "2026-10-21T12:00:00+00:00"


def feature(name="Palolem Beach", identity=123, latitude=15.01, longitude=74.02, **properties):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [longitude, latitude]}, "properties": {"name": name, "osm_id": identity, "osm_type": "W", "osm_key": "natural", "osm_value": "beach", "state": "Goa", "countrycode": "IN", "city": "Canacona", **properties}}


def test_normalization_keeps_goa_sources_and_rejects_foreign_invalid_and_duplicate_records():
    rows = [feature(), feature(), feature("Elsewhere", 2, state="Maharashtra"), feature("Outside", 3, latitude=18), feature("Bad", 4, longitude=float("nan")), feature("Missing state", 5, state=""), feature("Invalid identity", "abc"), {"geometry": None}, feature("Cafe", 8, osm_key="amenity", osm_value="cafe")]
    places = normalise_features({"features": rows}, NOW)
    assert [place.title for place in places] == ["Palolem Beach", "Cafe"]
    assert places[0].id == "osm-way-123"
    assert places[0].sourceUrl == "https://www.openstreetmap.org/way/123"
    assert places[1].category == "cafe"
    assert places[0].origin == "openstreetmap" and places[0].checkedAt == NOW
    assert "rating" not in places[0].model_dump()
    with pytest.raises(SearchUnavailable):
        normalise_features({"error": "not GeoJSON"}, NOW)


def test_alias_merging_prefers_reviewed_place_and_filters_real_results(monkeypatch):
    assert normalize_query("  PALOM   BEACH ") == "palolem beach"
    remote = normalise_features({"features": [feature(), feature("Canacona cafe", 8, osm_key="amenity", osm_value="cafe")]}, NOW)
    queries = []
    monkeypatch.setattr(place_search.photon, "search", lambda q: queries.append(q) or remote)
    result = search_all("Palom Beach", None, None)
    assert queries == ["palolem beach"]
    assert [place.origin for place in result.places] == ["reviewed", "openstreetmap"]
    assert result.places[0].id == "palolem-beach"
    assert result.providerAvailable
    assert len(search_all("Palom Beach", "beach", "south").places) == 1
    assert search_all("Palom Beach", None, "north").places == []


def test_provider_failure_is_explicit_and_reviewed_results_are_not_fabricated(monkeypatch):
    def unavailable(_query):
        raise SearchUnavailable()
    monkeypatch.setattr(place_search.photon, "search", unavailable)
    client = TestClient(app)
    response = client.get("/v1/search?q=Palom%20Beach")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["providerAvailable"] is False
    assert body["places"][0]["id"] == "palolem-beach"
    assert body["places"][0]["origin"] == "reviewed"
    assert "temporarily unavailable" in body["providerNotice"]
    assert client.get("/v1/search?q=nowhere-xyz").json()["places"] == []


@pytest.mark.parametrize("query", ["", "?q=", "?q=ab", "?q=%20%20%20", "?q=" + "a" * 81, "?q=%00abc", "?q=Goa&q=Beach", "?q=Goa&url=http://example.invalid", "?q=Goa&region=west", "?q=Goa&category=unknown"])
def test_bad_search_never_reaches_provider(monkeypatch, query):
    def forbidden(_query):
        raise AssertionError("Invalid input reached upstream")
    monkeypatch.setattr(place_search.photon, "search", forbidden)
    assert TestClient(app).get("/v1/search" + query).status_code == 400


def test_upstream_is_bounded_identified_cached_and_not_given_account_headers(monkeypatch):
    calls, waits = [], []
    payload = json.dumps({"features": [feature("Cafe", 8, osm_key="amenity", osm_value="cafe")]}).encode()
    class Response(io.BytesIO):
        status = 200
        headers = {"Content-Type": "application/geo+json; charset=utf-8"}
    class Opener:
        def open(self, request, timeout):
            calls.append((request, timeout))
            return Response(payload)
    monkeypatch.setenv("PHOTON_API_URL", "https://photon.example.invalid/api/")
    monkeypatch.setattr(place_search, "build_opener", lambda *_args: Opener())
    monkeypatch.setattr(place_search.time, "sleep", lambda duration: waits.append(duration))
    search = PhotonSearch()
    first = search.search("palolem")
    assert search.search("palolem") == first and len(calls) == 1
    request, timeout = calls[0]
    assert "bbox=73.6%2C14.8%2C74.4%2C15.9" in request.full_url
    assert timeout == 5
    assert set(dict(request.header_items())) == {"Accept", "User-agent"}
    assert "GoaTogether" in request.get_header("User-agent")
    assert all(0 <= duration <= 1 for duration in waits)


@pytest.mark.parametrize("endpoint", ["file:///private", "https://user:pass@example.invalid/api", "https://example.invalid/api?url=private", "http://example.invalid/api"])
def test_invalid_provider_configuration_fails_closed(monkeypatch, endpoint):
    monkeypatch.setenv("PHOTON_API_URL", endpoint)
    with pytest.raises(SearchUnavailable):
        PhotonSearch().search("palolem")


def test_demo_is_not_silently_used_in_production(monkeypatch):
    monkeypatch.delenv("PHOTON_API_URL", raising=False)
    monkeypatch.setenv("NODE_ENV", "production")
    with pytest.raises(SearchUnavailable):
        PhotonSearch().search("palolem")


@pytest.mark.parametrize("body,content_type,status", [(b"{invalid", "application/json", 200), (b"x" * 131073, "application/json", 200), (b"<html>Failure</html>", "text/html", 200), (b"{}", "application/json", 429)], ids=["invalid-json", "oversized", "html", "throttled"])
def test_upstream_failure_is_bounded_and_has_a_cooldown(monkeypatch, body, content_type, status):
    calls = []
    class Response(io.BytesIO):
        headers = {"Content-Type": content_type}
    Response.status = status
    class Opener:
        def open(self, *_args, **_kwargs):
            calls.append(1)
            return Response(body)
    monkeypatch.setenv("PHOTON_API_URL", "https://photon.example.invalid/api/")
    monkeypatch.setattr(place_search, "build_opener", lambda *_args: Opener())
    search = PhotonSearch()
    for _ in range(2):
        with pytest.raises(SearchUnavailable):
            search.search("palolem")
    assert len(calls) == 1
