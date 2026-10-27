"""Small HTTP API around the "Waste Collection Schedule" library (no Home Assistant).

GET  /health
GET  /search?q=<town>&country=de[&limit=40]      municipalities / services
GET  /source/<source>/params?lang=de[&preset=…]   parameters a source needs
GET  /source/<source>/options?param=<p>&q=<text>&args=<json>   lookup values for a parameter
POST /fetch {source, args, days?}                 → {source, entries: [{date, type, icon}]}

Errors are returned as JSON: {"error": "...", "argument": "...", "suggestions": [...]}.
"""

from __future__ import annotations

import concurrent.futures
import datetime
import difflib
import importlib
import inspect
import json
import logging
import os
import re
import sys
import threading
import time
import types
import typing
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

WCS_DIR = Path(os.environ.get("WCS_DIR", "/opt/wcs"))
sys.path.insert(0, str(WCS_DIR))

from waste_collection_schedule.exceptions import (  # noqa: E402
    SourceArgumentException,
    SourceArgumentExceptionMultiple,
    SourceArgumentSuggestionsExceptionBase,
)

import lookups  # noqa: E402

PORT = int(os.environ.get("PORT", "8098"))
CACHE_TTL = int(os.environ.get("CACHE_TTL", str(6 * 3600)))
ERROR_TTL = 600
FETCH_TIMEOUT = int(os.environ.get("FETCH_TIMEOUT", "90"))
SOURCE_DIR = WCS_DIR / "waste_collection_schedule" / "source"
SKIP_MODULES = {"ics", "static"}  # need an iCal URL / fixed dates – the mirror does that itself

COUNTRIES = {
    "Germany": "de", "Austria": "at", "Switzerland": "ch", "Netherlands": "nl", "Belgium": "be",
    "Luxembourg": "lu", "France": "fr", "Italy": "it", "Poland": "pl", "Czech Republic": "cz",
    "Denmark": "dk", "Sweden": "se", "Norway": "no", "Finland": "fi", "Lithuania": "lt",
    "Slovenia": "si", "Hungary": "hu", "United Kingdom": "uk", "Ireland": "ie", "United States of America": "us",
    "Canada": "ca", "Australia": "au", "New Zealand": "nz", "South Africa": "za",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("wastecollect")
pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)


class ApiError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status = status
        self.extra = extra


# ---- text helpers ---------------------------------------------------------------------------

UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


def norm(s: str, umlauts: bool = True) -> str:
    s = str(s).lower()
    if umlauts:
        s = s.translate(UMLAUTS)
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def variants(s: str) -> set[str]:
    return {norm(s), norm(s, umlauts=False)}


def match_score(q: str, text: str) -> float:
    """0 = no match. Umlaut-insensitive (München = Muenchen = Munchen), tolerant to typos."""
    best = 0.0
    for qv in variants(q):
        if not qv:
            continue
        for tv in variants(text):
            words = tv.split()
            if tv == qv:
                score = 100
            elif tv.startswith(qv):
                score = 90
            elif any(w.startswith(qv) for w in words) or f" {qv}" in f" {tv}":
                score = 80
            elif qv in tv:
                score = 60
            else:
                qn = len(qv)
                ratio = max([difflib.SequenceMatcher(None, qv, w[: qn + 1]).ratio() for w in words] + [0])
                score = 45 * ratio if ratio >= 0.85 and qn >= 4 else 0
            best = max(best, score)
    return best


# ---- source index ---------------------------------------------------------------------------

_index: list[dict] | None = None
_index_lock = threading.Lock()


def _module_title(module: str) -> str:
    try:
        text = (SOURCE_DIR / f"{module}.py").read_text(encoding="utf-8")
    except OSError:
        return module
    m = re.search(r'^TITLE\s*=\s*["\'](.+?)["\']\s*$', text, re.M)
    return m.group(1) if m else module


def index() -> list[dict]:
    global _index
    with _index_lock:
        if _index is None:
            data = json.loads((WCS_DIR / "sources.json").read_text(encoding="utf-8"))
            titles: dict[str, str] = {}
            out = []
            seen = set()
            for country, entries in data.items():
                code = COUNTRIES.get(country, country.lower())
                for e in entries:
                    mod = e["module"]
                    if mod in SKIP_MODULES or not (SOURCE_DIR / f"{mod}.py").exists():
                        continue
                    params = e.get("default_params") or {}
                    key = (mod, e["title"], json.dumps(params, sort_keys=True))
                    if key in seen:
                        continue
                    seen.add(key)
                    if mod not in titles:
                        titles[mod] = _module_title(mod)
                    service = titles[mod]
                    out.append({
                        "id": f"{mod}:{norm(e['title']).replace(' ', '-')}:{len(out)}",
                        "title": e["title"],
                        "service": service if norm(service) != norm(e["title"]) else "",
                        "source": mod,
                        "country": code,
                        "args_template": params,
                    })
            _index = out
            log.info("indexed %d entries", len(out))
        return _index


def search(q: str, country: str = "de", limit: int = 40) -> list[dict]:
    q = q.strip()
    if len(q) < 2:
        return []
    results = []
    for e in index():
        s = max(match_score(q, e["title"]), match_score(q, e["service"]) * 0.7 if e["service"] else 0)
        if s <= 0:
            continue
        if e["country"] == country:
            s += 1000
        results.append((s, e))
    if any(s % 1000 >= 60 for s, _ in results):  # drop fuzzy hits when there are real ones
        results = [(s, e) for s, e in results if s % 1000 >= 60]
    results.sort(key=lambda r: (-r[0], len(r[1]["title"]), r[1]["title"]))
    return [e for _, e in results[:limit]]


# ---- sources --------------------------------------------------------------------------------

def load_module(source: str) -> types.ModuleType:
    if not re.fullmatch(r"[a-z0-9_]+", source or "") or not (SOURCE_DIR / f"{source}.py").exists():
        raise ApiError(404, f"Unknown source '{source}'")
    return importlib.import_module(f"waste_collection_schedule.source.{source}")


def _annotation_info(ann) -> tuple[str, list | None]:
    """→ (type, options) for an __init__ annotation."""
    if ann is inspect.Parameter.empty:
        return "text", None
    origin = typing.get_origin(ann)
    if origin is typing.Literal:
        return "select", [str(a) for a in typing.get_args(ann) if a is not None]
    if origin in (typing.Union, types.UnionType):
        args = [a for a in typing.get_args(ann) if a is not type(None)]
        infos = [_annotation_info(a) for a in args]
        for t, opts in infos:
            if t == "select":
                return t, opts
        kinds = {t for t, _ in infos}
        if "text" in kinds:
            return "text", None
        return (infos[0] if infos else ("text", None))
    if origin is list or ann is list:
        return "list", None
    if ann is bool:
        return "bool", None
    if ann in (int, float):
        return "number", None
    return "text", None


def _source_text(mod: types.ModuleType) -> str:
    try:
        text = Path(mod.__file__).read_text(encoding="utf-8")
    except OSError:
        return ""
    # include shared services the source uses (they raise the suggestion errors)
    for svc in re.findall(r"waste_collection_schedule\.service\.?(?:import )?\s*([A-Za-z_]+)", text):
        p = WCS_DIR / "waste_collection_schedule" / "service" / f"{svc}.py"
        if p.exists():
            text += p.read_text(encoding="utf-8")
    return text


def _translated(mod, attr: str, lang: str) -> dict:
    d = getattr(mod, attr, None)
    if not isinstance(d, dict):
        return {}
    v = d.get(lang) or d.get("en") or {}
    return v if isinstance(v, dict) else ({"_": v} if isinstance(v, str) else {})


COMMON_LABELS = {
    "street": ("Street", "Straße"), "strasse": ("Street", "Straße"), "streetname": ("Street", "Straße"),
    "street_name": ("Street", "Straße"), "f_id_strasse": ("Street", "Straße"),
    "hnr": ("House number", "Hausnummer"), "house_number": ("House number", "Hausnummer"),
    "housenumber": ("House number", "Hausnummer"), "hausnummer": ("House number", "Hausnummer"),
    "streetnr": ("House number", "Hausnummer"), "number": ("House number", "Hausnummer"),
    "f_id_strasse_hnr": ("House number", "Hausnummer"),
    "city": ("Town", "Ort"), "ort": ("Town", "Ort"), "town": ("Town", "Ort"), "kommune": ("Municipality", "Gemeinde"),
    "municipality": ("Municipality", "Gemeinde"), "commune": ("Municipality", "Gemeinde"),
    "gemeinde": ("Municipality", "Gemeinde"), "f_id_kommune": ("Municipality", "Gemeinde"),
    "district": ("District", "Ortsteil"), "bezirk": ("District", "Bezirk"), "ortsteil": ("District", "Ortsteil"),
    "f_id_bezirk": ("District", "Bezirk"), "area": ("Area", "Gebiet"),
    "postcode": ("Postcode", "Postleitzahl"), "plz": ("Postcode", "Postleitzahl"), "zip": ("Postcode", "Postleitzahl"),
    "f_abfallarten": ("Waste types (optional)", "Abfallarten (optional)"), "wasteTypes": ("Waste types (optional)", "Abfallarten (optional)"),
    "idHouseNumber": ("Address", "Adresse"), "schedule_id": ("Address", "Adresse"),
    "landkreis": ("County", "Landkreis"), "bundesland": ("State", "Bundesland"),
}


def humanize(name: str) -> str:
    s = re.sub(r"^f_id_|^f_|_id$", "", name).replace("_", " ")
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", s)
    return s[:1].upper() + s[1:]


def params(source: str, lang: str = "de") -> dict:
    mod = load_module(source)
    sig = inspect.signature(mod.Source.__init__)
    labels = _translated(mod, "PARAM_TRANSLATIONS", lang)
    descs = _translated(mod, "PARAM_DESCRIPTIONS", lang)
    howto = getattr(mod, "HOW_TO_GET_ARGUMENTS_DESCRIPTION", None)
    if isinstance(howto, dict):
        howto = howto.get(lang) or howto.get("en") or ""
    flow_types = getattr(mod, "CONFIG_FLOW_TYPES", {}) or {}
    text = _source_text(mod)
    suggests = "Suggestions" in text
    custom = lookups.CUSTOM.get(source, {})
    out = []
    for name, p in sig.parameters.items():
        if name == "self" or p.kind in (p.VAR_KEYWORD, p.VAR_POSITIONAL):
            continue
        typ, options = _annotation_info(p.annotation)
        default = None if p.default is inspect.Parameter.empty else p.default
        if typ == "text" and isinstance(default, bool):
            typ = "bool"
        elif typ == "text" and isinstance(default, (int, float)) and not isinstance(default, bool):
            typ = "number"
        ft = flow_types.get(name)
        if isinstance(ft, dict) and ft.get("type") == "SELECT":
            typ, options = "select", [str(v) for v in ft.get("values", [])]
        entry = {
            "name": name,
            "label": labels.get(name) or (COMMON_LABELS[name][1 if lang == "de" else 0] if name in COMMON_LABELS else humanize(name)),
            "help": descs.get(name) or "",
            "required": p.default is inspect.Parameter.empty,
            "default": default if isinstance(default, (str, int, float, bool)) else None,
            "type": typ,
        }
        if options:
            entry["options"] = options
        if name in custom:
            entry["lookup"] = custom[name]
        elif suggests and typ == "text" and re.search(rf"[\"']{re.escape(name)}[\"']", text):
            entry["lookup"] = {"kind": "suggest"}
        out.append(entry)
    order = list(custom)
    out.sort(key=lambda e: order.index(e["name"]) if e["name"] in order else -1)
    # virtual helper parameters (only used for lookups, never passed to the source)
    for v in lookups.VIRTUAL.get(source, []):
        entry = {k: val for k, val in v.items() if k != "position"}
        if isinstance(entry["label"], dict):
            entry["label"] = entry["label"].get(lang) or entry["label"]["en"]
        out.insert(v.get("position", 0), entry)
    return {
        "source": source,
        "title": getattr(mod, "TITLE", source),
        "url": getattr(mod, "URL", ""),
        "description": getattr(mod, "DESCRIPTION", ""),
        "howto": howto if isinstance(howto, str) else "",
        "docs": f"https://github.com/mampfes/hacs_waste_collection_schedule/blob/master/doc/source/{source}.md",
        "params": out,
    }


def clean_args(mod: types.ModuleType, args: dict) -> dict:
    """Drop helper/empty values and coerce strings to what the source expects."""
    sig = inspect.signature(mod.Source.__init__).parameters
    has_kwargs = any(p.kind == p.VAR_KEYWORD for p in sig.values())
    out = {}
    for k, v in (args or {}).items():
        if k.startswith("_") or v is None or (isinstance(v, str) and not v.strip()):
            continue
        if k not in sig and not has_kwargs:
            continue
        if isinstance(v, str):
            v = v.strip()
            p = sig.get(k)
            if p is not None:
                typ, _ = _annotation_info(p.annotation)
                if typ == "list":
                    v = [x.strip() for x in v.split(",") if x.strip()]
                elif typ == "number" and re.fullmatch(r"-?\d+", v):
                    v = int(v)
                elif typ == "bool":
                    v = v.lower() in ("1", "true", "yes", "ja")
        out[k] = v
    return out


def run(fn, *a, timeout: int = FETCH_TIMEOUT):
    fut = pool.submit(fn, *a)
    try:
        return fut.result(timeout=timeout)
    except concurrent.futures.TimeoutError:
        raise ApiError(504, "The waste service did not answer in time")


def source_error(err: Exception) -> ApiError:
    if isinstance(err, ApiError):
        return err
    if isinstance(err, SourceArgumentSuggestionsExceptionBase):
        sugg = [str(s) for s in list(err.suggestions)[:200]]
        return ApiError(400, err.simple_message, argument=err.argument, suggestions=sugg)
    if isinstance(err, SourceArgumentException):
        return ApiError(400, err.message, argument=err.argument)
    if isinstance(err, SourceArgumentExceptionMultiple):
        return ApiError(400, err.message, arguments=list(err.arguments))
    if isinstance(err, TypeError) and "argument" in str(err):
        return ApiError(400, str(err))
    msg = str(err) or err.__class__.__name__
    return ApiError(502, msg[:500])


def _fetch_raw(mod, args):
    return mod.Source(**args).fetch()


_cache: dict[str, tuple[float, object]] = {}
_cache_lock = threading.Lock()


def fetch(source: str, args: dict, days: int = 120) -> dict:
    mod = load_module(source)
    args = clean_args(mod, args)
    days = max(1, min(int(days or 120), 400))
    key = json.dumps([source, args], sort_keys=True, default=str)
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        for k in [k for k, (exp, _) in _cache.items() if exp < now]:
            _cache.pop(k, None)
    if hit and hit[0] > now:
        result = hit[1]
    else:
        try:
            raw = run(_fetch_raw, mod, args)
            result = sorted(
                ({"date": c.date.isoformat(), "type": str(c.type).strip(), "icon": c.icon or ""} for c in raw),
                key=lambda e: (e["date"], e["type"]),
            )
            ttl = CACHE_TTL
        except Exception as err:  # noqa: BLE001
            log.warning("fetch %s failed: %s", source, err)
            result = source_error(err)
            ttl = ERROR_TTL
        with _cache_lock:
            _cache[key] = (now + ttl, result)
    if isinstance(result, ApiError):
        raise result
    today = datetime.date.today().isoformat()
    last = (datetime.date.today() + datetime.timedelta(days=days)).isoformat()
    entries = [e for e in result if today <= e["date"] <= last]
    seen, uniq = set(), []
    for e in entries:
        k = (e["date"], e["type"])
        if k not in seen:
            seen.add(k)
            uniq.append(e)
    return {"source": source, "entries": uniq, "types": sorted({e["type"] for e in result})}


def options(source: str, param: str, args: dict, q: str = "") -> dict:
    """Lookup values for one parameter: custom lookups, else the source's own suggestions."""
    mod = load_module(source)
    custom = lookups.HANDLERS.get(source)
    if custom and param in lookups.CUSTOM.get(source, {}):
        try:
            opts = run(custom, param, dict(args or {}), q, timeout=60)
        except lookups.LookupError_ as err:
            raise ApiError(400, str(err), argument=getattr(err, "argument", None))
        except ApiError:
            raise
        except Exception as err:  # noqa: BLE001
            raise ApiError(502, str(err)[:300])
        return {"param": param, "options": filter_options(opts, q if lookups.filter_locally(source, param) else "")}

    # generic: ask the source with a dummy value and collect the suggestions it raises
    probe = clean_args(mod, args)
    probe[param] = q.strip() or "␀"
    for name, p in inspect.signature(mod.Source.__init__).parameters.items():
        if name != "self" and p.default is inspect.Parameter.empty and name not in probe and p.kind not in (p.VAR_KEYWORD, p.VAR_POSITIONAL):
            probe[name] = "1"  # placeholder so the source gets far enough to raise its suggestions
    try:
        run(_fetch_raw, mod, probe, timeout=60)
    except SourceArgumentSuggestionsExceptionBase as err:
        if err.argument == param:
            opts = [{"value": str(s), "label": str(s)} for s in err.suggestions]
            return {"param": param, "options": filter_options(opts, q)}
        raise ApiError(400, err.simple_message, argument=err.argument)
    except ApiError:
        raise
    except Exception as err:  # noqa: BLE001
        e = source_error(err)
        if e.extra.get("argument") == param:
            return {"param": param, "options": [], "message": str(e)}
        raise e
    # the value was accepted
    return {"param": param, "options": [{"value": q.strip(), "label": q.strip()}] if q.strip() else []}


def filter_options(opts: list[dict], q: str, limit: int = 300) -> list[dict]:
    q = q.strip()
    if q:
        scored = [(match_score(q, o["label"]), o) for o in opts]
        opts = [o for s, o in sorted(scored, key=lambda x: -x[0]) if s > 0]
    return opts[:limit]


# ---- HTTP -----------------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "wastecollect/1"

    def log_message(self, fmt, *a):  # quieter access log
        if os.environ.get("ACCESS_LOG"):
            super().log_message(fmt, *a)

    def _send(self, status: int, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle(self, fn):
        try:
            self._send(200, fn())
        except ApiError as err:
            self._send(err.status, {"error": str(err), **{k: v for k, v in err.extra.items() if v is not None}})
        except Exception as err:  # noqa: BLE001
            log.exception("request failed")
            self._send(500, {"error": str(err) or err.__class__.__name__})

    def do_GET(self):
        url = urlparse(self.path)
        qs = {k: v[-1] for k, v in parse_qs(url.query).items()}
        parts = [p for p in url.path.split("/") if p]
        if parts == ["health"]:
            return self._send(200, {"ok": True, "library": (WCS_DIR / "VERSION").read_text().strip() if (WCS_DIR / "VERSION").exists() else "dev"})
        if parts == ["search"]:
            return self._handle(lambda: search(qs.get("q", ""), qs.get("country", "de").lower(), min(int(qs.get("limit", 40) or 40), 100)))
        if len(parts) == 3 and parts[0] == "source" and parts[2] == "params":
            return self._handle(lambda: params(parts[1], qs.get("lang", "de")[:2]))
        if len(parts) == 3 and parts[0] == "source" and parts[2] == "options":
            def opt():
                try:
                    args = json.loads(qs.get("args") or "{}")
                except ValueError:
                    raise ApiError(400, "args must be JSON")
                # plain query parameters are accepted as args too
                for k, v in qs.items():
                    if k not in ("param", "q", "args", "lang"):
                        args.setdefault(k, v)
                if not qs.get("param"):
                    raise ApiError(400, "param is required")
                return options(parts[1], qs["param"], args, qs.get("q", ""))
            return self._handle(opt)
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path.rstrip("/") != "/fetch":
            return self._send(404, {"error": "Not found"})

        def go():
            try:
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(min(n, 100_000)) or b"{}")
            except ValueError:
                raise ApiError(400, "Invalid JSON")
            if not isinstance(body, dict) or not body.get("source"):
                raise ApiError(400, "source is required")
            args = body.get("args") or {}
            if not isinstance(args, dict):
                raise ApiError(400, "args must be an object")
            return fetch(str(body["source"]), args, body.get("days") or 120)

        self._handle(go)


def main():
    threading.Thread(target=index, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    log.info("listening on :%d", PORT)
    srv.serve_forever()


if __name__ == "__main__":
    main()
