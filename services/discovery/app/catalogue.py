"""Read-only, reviewed editorial catalogue; changing it requires a new source review."""

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

Category = Literal[
    "beach", "food", "cafe", "nightlife", "culture", "adventure", "shopping", "transport", "other"
]
Region = Literal["north", "south", "central"]


class Place(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=600)
    category: Category
    region: Region
    area: str = Field(min_length=1, max_length=80)
    latitude: float = Field(ge=14.8, le=15.9)
    longitude: float = Field(ge=73.6, le=74.4)
    sourceUrl: str = Field(max_length=500)
    checkedAt: str

    @field_validator("sourceUrl")
    @classmethod
    def valid_source(cls, value: str) -> str:
        source = urlparse(value)
        if source.scheme != "https" or not source.hostname or source.username or source.password:
            raise ValueError("Catalogue sources must be public HTTPS URLs.")
        return value

    @field_validator("checkedAt")
    @classmethod
    def valid_checked_at(cls, value: str) -> str:
        checked = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if checked.tzinfo is None:
            raise ValueError("Review timestamp must include its time zone.")
        return value


class CatalogueInfo(BaseModel):
    kind: Literal["curated"] = "curated"
    checkedAt: str
    notice: str


class PlaceResults(BaseModel):
    places: list[Place]
    total: int
    catalogue: CatalogueInfo


class PlaceDetail(BaseModel):
    place: Place


def load_places() -> tuple[Place, ...]:
    records = json.loads((Path(__file__).parent / "data" / "places.json").read_text(encoding="utf-8"))
    places = tuple(Place.model_validate(record) for record in records)
    if len({place.id for place in places}) != len(places):
        raise ValueError("Catalogue place IDs must be unique.")
    if not places:
        raise ValueError("Catalogue must contain reviewed places.")
    return places


PLACES = load_places()
BY_ID = {place.id: place for place in PLACES}
CATALOGUE = CatalogueInfo(
    checkedAt=min(place.checkedAt for place in PLACES),
    notice=(
        "A small, source-reviewed Goa catalogue, not complete or live inventory. "
        "Map pins are approximate editorial locations, not verified entrances or navigation. "
        "Check the linked source and local conditions before visiting; hours, prices, availability and ratings are not supplied."
    ),
)


def normalize_query(q: str) -> str:
    return re.sub(r"\bpalom\b", "palolem", " ".join(q.casefold().split()))


def search_places(q: str, category: str | None, region: str | None) -> list[Place]:
    # Split words so 'old goa' matches consistently even with repeated spaces.
    terms = normalize_query(q).split()
    return [
        place
        for place in PLACES
        if (not category or place.category == category)
        and (not region or region == "all" or place.region == region)
        and all(
            term in " ".join((place.title, place.description, place.area, place.category, place.region)).casefold()
            for term in terms
        )
    ]
