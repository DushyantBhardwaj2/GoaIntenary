from datetime import datetime, timezone
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient

from app.catalogue import PLACES
from app.main import app

client = TestClient(app)


def test_health_and_curated_catalogue_contract():
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "catalogueCount": 16}
    response = client.get("/v1/places")
    body = response.json()
    assert response.status_code == 200
    assert body["total"] == len(body["places"]) == 16
    assert body["catalogue"]["kind"] == "curated"
    assert "not complete or live" in body["catalogue"]["notice"]
    assert "approximate" in body["catalogue"]["notice"]
    assert "max-age=300" in response.headers["cache-control"]


def test_reviewed_places_have_stable_exact_fields_and_source_context():
    expected = {"id", "title", "description", "category", "region", "area", "latitude", "longitude", "sourceUrl", "checkedAt"}
    records = client.get("/v1/places").json()["places"]
    assert len({place["id"] for place in records}) == len(records)
    for place in records:
        assert set(place) == expected
        assert 14.8 <= place["latitude"] <= 15.9
        assert 73.6 <= place["longitude"] <= 74.4
        assert place["region"] in {"north", "south", "central"}
        assert place["category"] in {"beach", "food", "cafe", "nightlife", "culture", "adventure", "shopping", "transport", "other"}
        source = urlparse(place["sourceUrl"])
        assert source.scheme == "https" and source.hostname == "goa-tourism.com"
        assert datetime.fromisoformat(place["checkedAt"].replace("Z", "+00:00")).tzinfo == timezone.utc
        detail = client.get(f"/v1/places/{place['id']}")
        assert detail.status_code == 200
        assert detail.json() == {"place": place}


@pytest.mark.parametrize("q, expected", [("Palolem", ["palolem-beach"]), ("  old   GOA  ", [place.id for place in PLACES if place.region == "central"]), ("a place with no match", [])])
def test_search_is_case_insensitive_and_matches_all_words(q, expected):
    response = client.get("/v1/places", params={"q": q})
    assert response.status_code == 200
    assert [place["id"] for place in response.json()["places"]] == expected
    assert response.json()["total"] == len(expected)


def test_region_and_category_filters_combine_without_fabricated_results():
    north = client.get("/v1/places?category=beach&region=north").json()
    assert north["total"] == 7 and all(place["region"] == "north" for place in north["places"])
    south = client.get("/v1/places?category=beach&region=south&q=beach").json()
    assert south["total"] == 3
    assert client.get("/v1/places?category=food").json()["places"] == []
    assert client.get("/v1/places?category=culture&region=north").json()["places"] == []
    assert client.get("/v1/places?region=all").json()["total"] == 16


@pytest.mark.parametrize("query", ["q=", "q=%20%20%20", "q=&category=&region="])
def test_empty_search_filters_mean_all_places(query):
    assert client.get(f"/v1/places?{query}").json()["total"] == 16


@pytest.mark.parametrize("query", ["region=west", "region=NORTH", "category=restaurant", "category=all", "q=" + "x" * 81, "q=%00", "q=%0A", "q=Goa&q=Palolem", "admin=true", "region=north&region=south"])
def test_invalid_unknown_duplicate_and_unbounded_filters_are_rejected(query):
    response = client.get(f"/v1/places?{query}")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.headers["cache-control"] == "no-store"


def test_details_not_found_and_filters_not_allowed():
    assert client.get("/v1/places/does-not-exist").status_code == 404
    assert client.get("/v1/places/palolem-beach?region=south").status_code == 400
    assert client.get("/v1/places/" + "a" * 81).status_code == 400


@pytest.mark.parametrize("path", ["/v1/trips", "/v1/users", "/v1/expenses", "/v1/admin", "/v1/places/palolem-beach/private"])
def test_no_private_endpoints_exist(path):
    assert client.get(path).status_code == 404


@pytest.mark.parametrize("method", ["post", "patch", "delete"])
def test_public_catalogue_has_no_write_routes(method):
    response = getattr(client, method)("/v1/places")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"
