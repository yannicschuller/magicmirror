"""Address lookups for sources whose parameters are ids (ported from the library's wizards).

CUSTOM[source][param]   lookup description sent to the admin UI:
    kind:  "search" (server searches with the typed text) or "list" (all values, filtered)
    ids:   true when values are ids – the UI shows the label and stores the id
    multi: several values (comma-separated)
VIRTUAL[source]         helper parameters (name starts with "_") only used to narrow lookups
HANDLERS[source](param, args, q) → [{value, label, set?: {param: value}}]
"""

from __future__ import annotations

import functools
import re
import time
from html.parser import HTMLParser

import requests

UA = {"user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"}


class LookupError_(Exception):
    def __init__(self, message: str, argument: str | None = None):
        super().__init__(message)
        self.argument = argument


def _need(args: dict, name: str, label: str):
    v = args.get(name)
    if v in (None, ""):
        raise LookupError_(f"Please choose {label} first", name)
    return v


# ---- BSR (Berlin) ---------------------------------------------------------------------------

BSR_STREETS = "https://umnewforms.bsr.de/p/de.bsr.adressen.app/streetNames"
BSR_SCHEDULE = "https://umnewforms.bsr.de/p/de.bsr.adressen.app/plzSet/plzSet"


def bsr_de(param: str, args: dict, q: str):
    m = re.match(r"^\s*(.+?)[\s,]+(\d+\s*[a-zA-Z]?(?:\s*-\s*\d+)?)\s*$", q or "")
    if not m:
        raise LookupError_("Enter street and house number, e.g. Kaiserdamm 1", param)
    street, number = m.group(1), m.group(2).replace(" ", "")
    r = requests.get(BSR_STREETS, params={"searchQuery": street}, headers=UA, timeout=20)
    r.raise_for_status()
    streets = [s["value"] for s in r.json()][:4]
    out = []
    for s in streets:
        r = requests.get(BSR_SCHEDULE, params={"searchQuery": f"{s}:::{number}"}, headers=UA, timeout=20)
        r.raise_for_status()
        out += [{"value": str(e["value"]), "label": e["label"]} for e in r.json()]
    return out


# ---- Stuttgart ------------------------------------------------------------------------------

def stuttgart_de(param: str, args: dict, q: str):
    if len((q or "").strip()) < 2:
        raise LookupError_("Type at least two letters of the street", param)
    r = requests.get("https://service.stuttgart.de/lhs-services/aws/strassennamen", params={"street": q.strip()}, headers=UA, timeout=20)
    r.raise_for_status()
    return [{"value": d["value"], "label": d["value"]} for d in r.json().get("suggestions", [])]


# ---- abfall.io (legacy form API) ------------------------------------------------------------

ABFALLIO_URL = "https://api.abfall.io"
ABFALLIO_MODUS = "d6c5855a62cf32a4dadbc2831f0f295f"
ABFALLIO_STEPS = ["f_id_kommune", "f_id_bezirk", "f_id_strasse", "f_id_strasse_hnr"]
ABFALLIO_LABELS = {
    "f_id_kommune": "the municipality",
    "f_id_bezirk": "the district",
    "f_id_strasse": "the street",
    "f_id_strasse_hnr": "the house number",
}
WACTION = re.compile(r'awk-data-onchange-submit-waction="([^"\r\n]+)"')


class _FormParser(HTMLParser):
    """Collects <select> options, hidden inputs and waste type checkboxes of an abfall.io form."""

    def __init__(self):
        super().__init__()
        self.selects: dict[str, list[tuple[str, str]]] = {}
        self.hidden: dict[str, str] = {}
        self.checkboxes: list[tuple[str, str]] = []  # (id, label-for)
        self.labels: dict[str, str] = {}
        self._select = None
        self._opt = None
        self._label_for = None
        self._text = ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "select" and a.get("name"):
            self._select = a["name"]
            self.selects.setdefault(self._select, [])
        elif tag == "option" and self._select:
            self._opt = a.get("value", "")
            self._text = ""
        elif tag == "input":
            t = a.get("type", "")
            if t == "hidden" and a.get("name"):
                self.hidden[a["name"]] = a.get("value", "")
                if a["name"] in ABFALLIO_STEPS:
                    self.selects.setdefault(a["name"], []).append((a.get("value", ""), a.get("value", "")))
            elif t == "checkbox" and (a.get("name") or "").startswith("f_id_abfalltyp"):
                self.checkboxes.append((a.get("value", ""), a.get("id", "")))
        elif tag == "label" and a.get("for"):
            self._label_for = a["for"]
            self._text = ""

    def handle_data(self, data):
        if self._opt is not None or self._label_for:
            self._text += data

    def handle_endtag(self, tag):
        if tag == "option" and self._opt is not None and self._select:
            if self._opt not in ("", "-1", "0") and self._text.strip():
                self.selects[self._select].append((self._opt, self._text.strip()))
            self._opt = None
        elif tag == "select":
            self._select = None
        elif tag == "label" and self._label_for:
            self.labels[self._label_for] = self._text.strip()
            self._label_for = None


def _abfallio_post(key: str, waction: str, data: dict) -> str:
    r = requests.post(ABFALLIO_URL, params={"key": key, "modus": ABFALLIO_MODUS, "waction": waction}, data=data, headers=UA, timeout=30)
    if r.status_code == 401:
        raise LookupError_("This provider moved to the new abfall.io API – search your town again and pick the newer entry")
    r.raise_for_status()
    return r.text


def abfall_io(param: str, args: dict, q: str):
    key = _need(args, "key", "the service")
    html = _abfallio_post(key, "init", {})
    answers: dict = {}
    for _ in range(8):
        p = _FormParser()
        p.feed(html)
        answers.update(p.hidden)
        if param == "f_abfallarten" and p.checkboxes:
            return [{"value": v, "label": p.labels.get(i) or v} for v, i in p.checkboxes]
        pending = [s for s in ABFALLIO_STEPS if s in p.selects and s not in answers]
        if not pending:
            if param in ABFALLIO_STEPS:
                return []  # this step does not exist for the provider
            raise LookupError_("No further choices")
        if param in ABFALLIO_STEPS and ABFALLIO_STEPS.index(pending[0]) > ABFALLIO_STEPS.index(param):
            return []  # the provider skips this step
        for step in pending:
            if step == param:
                return [{"value": v, "label": lbl} for v, lbl in p.selects[step]]
            answers[step] = _need(args, step, ABFALLIO_LABELS[step])
        m = WACTION.search(html)
        if not m:
            raise LookupError_("Unexpected answer from abfall.io")
        html = _abfallio_post(key, m.group(1), answers)
    raise LookupError_("Unexpected answer from abfall.io")


# ---- abfall.io GraphQL (v3) -----------------------------------------------------------------

GQL_URL = "https://widgets.abfall.io/graphql"


@functools.lru_cache(maxsize=64)
def _gql_key(service_key: str, _hour: int) -> str:
    r = requests.get(ABFALLIO_URL, params={"key": service_key}, headers=UA, timeout=20)
    r.raise_for_status()
    return r.json()["apiKey"]


def _gql(service_key: str, query: str, variables: dict):
    from waste_collection_schedule.service.AbfallIOGraphQL import SERVICE_MAP

    api_key = _gql_key(service_key, int(time.time() // 3600))
    headers = {**UA, "x-abfallplus-api-key": api_key}
    # some providers only accept requests carrying their own website as origin
    origin = next((s["url"].rstrip("/") for s in SERVICE_MAP if s["service_id"] == service_key and s.get("url")), None)
    if origin:
        headers.update({"Origin": origin, "Referer": f"{origin}/"})
    r = requests.post(GQL_URL, json={"query": query, "variables": variables}, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json().get("data") or {}


def abfall_io_graphql(param: str, args: dict, q: str):
    key = _need(args, "key", "the service")
    if param == "_city":
        data = _gql(key, "query($q:String){cities(query:$q){id name idHouseNumber districtsCount appointmentsSupported}}", {"q": (q or "").strip()})
        return [
            {"value": c["id"], "label": c["name"], "set": {"idHouseNumber": c["idHouseNumber"]} if c.get("idHouseNumber") else {}}
            for c in data.get("cities", [])
            if c.get("appointmentsSupported", True)
        ]
    if param == "_district":
        city = _need(args, "_city", "the town")
        data = _gql(key, "query($id:ID!){city(id:$id){districts{id name idHouseNumber}}}", {"id": city})
        return [
            {"value": d["id"], "label": d["name"], "set": {"idHouseNumber": d["idHouseNumber"]} if d.get("idHouseNumber") else {}}
            for d in (data.get("city") or {}).get("districts") or []
        ]
    if param == "_street":
        parent, pid = ("district", args["_district"]) if args.get("_district") else ("city", _need(args, "_city", "the town"))
        data = _gql(key, f"query($id:ID!){{{parent}(id:$id){{streets{{id name idHouseNumber}}}}}}", {"id": pid})
        return [
            {"value": s["id"], "label": s["name"], "set": {"idHouseNumber": s["idHouseNumber"]} if s.get("idHouseNumber") else {}}
            for s in (data.get(parent) or {}).get("streets") or []
        ]
    if param == "idHouseNumber":
        street = _need(args, "_street", "the street")
        data = _gql(
            key,
            "query($id:ID!,$d:ID){street(id:$id){houseNumbers(idDistrict:$d){id name}}}",
            {"id": street, "d": args.get("_district") or None},
        )
        return [{"value": h["id"], "label": h["name"]} for h in (data.get("street") or {}).get("houseNumbers") or []]
    if param == "wasteTypes":
        hn = _need(args, "idHouseNumber", "the address")
        data = _gql(key, "query($id:ID!){houseNumber(id:$id){wasteTypes{id name}}}", {"id": hn})
        return [{"value": w["id"], "label": w["name"]} for w in (data.get("houseNumber") or {}).get("wasteTypes") or []]
    raise LookupError_("No lookup for this parameter")


# ---- registry -------------------------------------------------------------------------------

def _list(ids=True, multi=False, depends=()):
    return {"kind": "list", "ids": ids, "multi": multi, "depends": list(depends)}


CUSTOM = {
    "bsr_de": {"schedule_id": {"kind": "search", "ids": True, "placeholder": "Street and house number"}},
    "stuttgart_de": {"street": {"kind": "search", "ids": False}},
    "abfall_io": {
        "f_id_kommune": _list(depends=["key"]),
        "f_id_bezirk": _list(depends=["f_id_kommune"]),
        "f_id_strasse": _list(depends=["f_id_kommune", "f_id_bezirk"]),
        "f_id_strasse_hnr": _list(depends=["f_id_strasse"]),
        "f_abfallarten": _list(multi=True, depends=["f_id_strasse", "f_id_strasse_hnr"]),
    },
    "abfall_io_graphql": {
        "_city": {"kind": "search", "ids": True, "depends": ["key"]},
        "_district": _list(depends=["_city"]),
        "_street": _list(depends=["_city", "_district"]),
        "idHouseNumber": _list(depends=["_street"]),
        "wasteTypes": _list(multi=True, depends=["idHouseNumber"]),
    },
}

VIRTUAL = {
    "abfall_io_graphql": [
        {"name": "_city", "label": {"en": "Town", "de": "Ort"}, "help": "", "required": False, "default": None, "type": "text", "position": 1, "lookup": CUSTOM["abfall_io_graphql"]["_city"]},
        {"name": "_district", "label": {"en": "District (if any)", "de": "Ortsteil (falls vorhanden)"}, "help": "", "required": False, "default": None, "type": "text", "position": 2, "lookup": CUSTOM["abfall_io_graphql"]["_district"]},
        {"name": "_street", "label": {"en": "Street", "de": "Straße"}, "help": "", "required": False, "default": None, "type": "text", "position": 3, "lookup": CUSTOM["abfall_io_graphql"]["_street"]},
    ],
}

HANDLERS = {
    "bsr_de": bsr_de,
    "stuttgart_de": stuttgart_de,
    "abfall_io": abfall_io,
    "abfall_io_graphql": abfall_io_graphql,
}


def filter_locally(source: str, param: str) -> bool:
    return CUSTOM.get(source, {}).get(param, {}).get("kind") == "list"
