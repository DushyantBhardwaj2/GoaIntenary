"""Bounded public Goa geocoding, isolated from private trip/account state."""
import json
import math
import os
import threading
import time
from collections import OrderedDict
from typing import Literal
from datetime import datetime, timezone
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from pydantic import BaseModel

from .catalogue import CATALOGUE, Place, normalize_query, search_places


class SearchPlace(Place):
    origin: Literal["reviewed", "openstreetmap"]


class SearchCatalogue(BaseModel):
    kind: str = "reviewed-and-openstreetmap"
    checkedAt: str = CATALOGUE.checkedAt
    notice: str = "Reviewed places and OpenStreetMap search results. Reference pins are approximate; no hours, ratings, prices or availability are verified."


class SearchResults(BaseModel):
    places: list[SearchPlace]
    total: int
    catalogue: SearchCatalogue = SearchCatalogue()
    providerAvailable: bool
    providerNotice: str
    attribution: str = "© OpenStreetMap contributors · search by Photon"
    attributionUrl: str = "https://www.openstreetmap.org/copyright"


class SearchUnavailable(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def clean_text(value, maximum):
    if not isinstance(value, str):
        return ""
    return " ".join("".join(char for char in value if ord(char) >= 32 and ord(char) != 127).split())[:maximum]


# Display labels only. A named place inside Goa is kept even when the geocoder's
# own type is "other" — that is how Photon classifies Palolem Beach.
_CATEGORY_BY_VALUE = {
    "beach": "beach",
    "cafe": "cafe",
    "restaurant": "food",
    "fast_food": "food",
    "food_court": "food",
    "bar": "nightlife",
    "pub": "nightlife",
    "nightclub": "nightlife",
    "biergarten": "nightlife",
    "museum": "culture",
    "attraction": "culture",
    "viewpoint": "culture",
    "gallery": "culture",
    "artwork": "culture",
    "fort": "culture",
    "castle": "culture",
    "ruins": "culture",
    "monument": "culture",
    "memorial": "culture",
    "archaeological_site": "culture",
    "marketplace": "shopping",
    "mall": "shopping",
    "bus_station": "transport",
    "station": "transport",
    "halt": "transport",
    "stop": "transport",
    "ferry_terminal": "transport",
    "aerodrome": "transport",
}


def display_category(key, value) -> str:
    kind = str(value or "")
    group = str(key or "")
    if kind in _CATEGORY_BY_VALUE:
        return _CATEGORY_BY_VALUE[kind]
    if group == "shop":
        return "shopping"
    if group in {"railway", "aeroway", "public_transport"} or (group == "landuse" and kind == "railway"):
        return "transport"
    if group == "historic":
        return "culture"
    if group == "place" and kind in {"city", "town", "village", "suburb", "neighbourhood", "hamlet", "locality"}:
        return "other"
    return "other"


def useful_place(key, value) -> bool:
    """Named beaches, forts, stations, markets, restaurants, viewpoints and towns stay.
    Streets, boundaries and the state itself are too broad to plan around."""
    group = str(key or "")
    kind = str(value or "")
    if group in {"highway", "junction", "route", "waterway"}:
        return False
    if group == "boundary":
        return False
    if group == "place" and kind in {"state", "country", "region", "county", "continent"}:
        return False
    if group == "landuse" and kind != "railway":
        return False
    if group == "amenity" and kind in {"parking", "parking_space", "parking_entrance", "police", "bank", "atm", "toilets", "bench", "waste_basket"}:
        return False
    return True


class SearchHits(list):
    skipped_broad: int = 0


def inside_goa(latitude: float, longitude: float, properties: dict) -> bool:
    if not (14.8 <= latitude <= 15.9 and 73.6 <= longitude <= 74.4):
        return False
    country = str(properties.get("countrycode", "")).casefold()
    state = str(properties.get("state", "")).casefold()
    # The search box is biased to Goa, but the rectangle still clips Maharashtra and Karnataka.
    return (not country or country == "in") and "goa" in state


def normalise_features(payload: dict, fetched_at: str) -> list[SearchPlace]:
    if not isinstance(payload, dict) or not isinstance(payload.get("features"), list):
        raise SearchUnavailable()
    places, seen, skipped = [], set(), 0
    for feature in payload["features"][:20]:
        try:
            properties, geometry = feature["properties"], feature["geometry"]
            if not isinstance(properties, dict) or geometry.get("type") != "Point":
                continue
            longitude, latitude = geometry["coordinates"][:2]
            if isinstance(latitude, bool) or isinstance(longitude, bool):
                continue
            latitude, longitude = float(latitude), float(longitude)
            if not math.isfinite(latitude) or not math.isfinite(longitude) or not inside_goa(latitude, longitude, properties):
                continue
            osm_type = {"N": "node", "W": "way", "R": "relation"}.get(properties.get("osm_type"))
            osm_id = properties.get("osm_id")
            title = clean_text(properties.get("name"), 120)
            if not osm_type or type(osm_id) is not int or osm_id < 1 or not title:
                continue
            identity = f"osm-{osm_type}-{osm_id}"
            if identity in seen:
                continue
            # properties["type"] is Photon's coarse class. Beaches arrive as "other"; do not reject on it.
            if not useful_place(properties.get("osm_key"), properties.get("osm_value")):
                skipped += 1
                continue
            seen.add(identity)
            category = display_category(properties.get("osm_key"), properties.get("osm_value"))
            area = clean_text(properties.get("city") or properties.get("district") or properties.get("county") or properties.get("state"), 80) or "Goa"
            region = "south" if latitude < 15.3 else "north" if latitude > 15.5 else "central"
            places.append(SearchPlace(id=identity, title=title, description=f"OpenStreetMap place data in {area}. Check the source and local conditions before visiting.", category=category, region=region, area=area, latitude=latitude, longitude=longitude, sourceUrl=f"https://www.openstreetmap.org/{osm_type}/{osm_id}", checkedAt=fetched_at, origin="openstreetmap"))
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
    hits = SearchHits(places[:8])
    hits.skipped_broad = skipped
    return hits


class PhotonSearch:
    def __init__(self):
        self._lock = threading.Lock()
        self._cache = OrderedDict()
        self._last_request = 0.0
        self._unavailable_until = 0.0

    def search(self, query: str) -> list[SearchPlace]:
        if not self._lock.acquire(timeout=0.2):
            raise SearchUnavailable()
        try:
            now = time.monotonic()
            cached = self._cache.get(query)
            if cached and now - cached[0] < 1800:
                self._cache.move_to_end(query)
                return cached[1]
            if now < self._unavailable_until:
                raise SearchUnavailable()
            # A private Photon-compatible endpoint can be configured. Without one, the public
            # demo is used, including on Lambda, so named Goa places still resolve. The same
            # timeout, cache and one-query-per-second limit apply.
            endpoint = (os.environ.get("PHOTON_API_URL") or "").strip() or "https://photon.komoot.io/api/"
            parsed = urlsplit(endpoint)
            if not endpoint or parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname or (parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"})):
                raise SearchUnavailable()
            # One shared request at a time, at most one new upstream query/sec.
            time.sleep(max(0, 1.0 - (time.monotonic() - self._last_request)))
            self._last_request = time.monotonic()
            url = endpoint + "?" + urlencode({"q": query, "bbox": "73.6,14.8,74.4,15.9", "limit": 12, "lang": "en", "lat": 15.4, "lon": 73.95})
            request = Request(url, headers={"Accept": "application/json", "User-Agent": "GoaTogether/0.1 (local trip planning place search)"})
            try:
                with build_opener(NoRedirect()).open(request, timeout=5) as response:
                    if response.status != 200 or response.headers.get("Content-Type", "").split(";")[0].strip().lower() not in {"application/json", "application/geo+json"}:
                        raise SearchUnavailable()
                    data = response.read(131073)
                    if len(data) > 131072:
                        raise SearchUnavailable()
                results = normalise_features(json.loads(data), datetime.now(timezone.utc).isoformat())
            except Exception:
                # Never expose upstream bodies, URLs, proxy settings or exceptions.
                self._unavailable_until = time.monotonic() + 20
                raise SearchUnavailable() from None
            self._cache[query] = (time.monotonic(), results)
            self._cache.move_to_end(query)
            while len(self._cache) > 256:
                self._cache.popitem(last=False)
            return results
        finally:
            self._lock.release()


photon = PhotonSearch()


def _selected(places: list[SearchPlace], category: str | None, region: str | None) -> list[SearchPlace]:
    selected = []
    for place in places:
        if category and place.category != category:
            continue
        if region and region != "all" and place.region != region:
            continue
        selected.append(place)
    return selected


def search_all(query: str, category: str | None, region: str | None) -> SearchResults:
    normalized = normalize_query(query)
    available = True
    try:
        remote = photon.search(normalized)
    except SearchUnavailable:
        available, remote = False, []
    # A typed query uses the live geocoder. The reviewed catalogue is only a fallback when that service fails.
    if available:
        places = _selected(remote, category, region)
        skipped = int(getattr(remote, "skipped_broad", 0) or 0)
        if not remote and skipped:
            notice = "That search only matched streets or a very broad area. Try a specific beach, fort, station, market, restaurant, viewpoint, or town."
        else:
            notice = "Live OpenStreetMap places inside Goa. The pin is a map match, not a checked listing, and saving it does not book anything."
    else:
        reviewed = [SearchPlace(**place.model_dump(), origin="reviewed") for place in search_places(normalized, None, None)]
        places = _selected(reviewed, category, region)
        notice = "Wider map search is temporarily unavailable. Only matching reviewed places are shown; retry to search more places."
    shown = places[:12]
    return SearchResults(places=shown, total=len(shown), providerAvailable=available, providerNotice=notice)
