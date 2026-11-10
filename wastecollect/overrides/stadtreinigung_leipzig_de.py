# Magic Mirror's own version of the library source "stadtreinigung_leipzig_de".
# Stadtreinigung Leipzig moved its street lookup to /rest/odata/Streets; the old
# /rest/Navision/Streets answers 405 and the library source fails with KeyError: 'results'
# (upstream issue mampfes/hacs_waste_collection_schedule#8159). Remove this file once a
# library release with a fix is pinned in the Dockerfile.
import re

import requests
from waste_collection_schedule import Collection  # type: ignore[attr-defined]
from waste_collection_schedule.exceptions import (
    SourceArgumentNotFound,
    SourceArgumentNotFoundWithSuggestions,
)
from waste_collection_schedule.service.ICS import ICS

TITLE = "Stadtreinigung Leipzig"
DESCRIPTION = "Source for Stadtreinigung Leipzig."
URL = "https://stadtreinigung-leipzig.de"
TEST_CASES = {"Bahnhofsallee": {"street": "Bahnhofsallee", "house_number": 7}}

API_STREETS = "https://stadtreinigung-leipzig.de/rest/odata/Streets"
API_ICS = "https://stadtreinigung-leipzig.de/wir-kommen-zu-ihnen/abfallkalender/ical.ics"


def _street_key(name):
    """'Karl-Heine-Str.' / 'karl heine strasse' → 'karlheinestrasse'."""
    s = str(name or "").lower().replace("ß", "ss")
    s = re.sub(r"str\.?$", "strasse", s.strip())
    return re.sub(r"[^a-z0-9äöü]", "", s)


def _number_key(number):
    """'1 a' / '1A' → '1a'."""
    return re.sub(r"\s+", "", str(number or "")).lower()


class Source:
    def __init__(self, street, house_number):
        self._street = str(street).strip()
        self._house_number = str(house_number).strip()
        self._ics = ICS()

    def fetch(self):
        r = requests.get(API_STREETS, params={"search": self._street}, timeout=30)
        r.raise_for_status()
        streets = r.json().get("results") or []
        if not streets:
            raise SourceArgumentNotFound("street", self._street)

        # The same street can appear once per postal code: collect the numbers of all of them.
        wanted = _street_key(self._street)
        matches = [s for s in streets if _street_key(s.get("name")) == wanted]
        if not matches:
            raise SourceArgumentNotFoundWithSuggestions(
                "street", self._street, sorted({s.get("name") for s in streets if s.get("name")})
            )
        numbers = [n for s in matches for n in s.get("numbers") or []]

        # A house number can have several positions (one per bin); the calendar takes them all.
        positions = []
        for n in numbers:
            if _number_key(n.get("number")) == _number_key(self._house_number):
                positions += [str(p) for p in n.get("position_nos") or [] if str(p) not in positions]
        if not positions:
            raise SourceArgumentNotFoundWithSuggestions(
                "house_number", self._house_number, [n.get("number") for n in numbers]
            )

        r = requests.get(
            API_ICS,
            params={
                "position_nos": ",".join(positions),
                "name": f"{matches[0].get('name')} {self._house_number}",
                "mode": "download",
            },
            timeout=30,
        )
        r.raise_for_status()
        return [Collection(d[0], d[1].removesuffix(", ")) for d in self._ics.convert(r.text)]
