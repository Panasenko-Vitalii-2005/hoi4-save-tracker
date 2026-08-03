"""
HOI4 Autosave Web Dashboard

Run:
    python hoi4_graph_web.py

Then open:
    http://127.0.0.1:8765
"""

from __future__ import annotations

import json
import os
import re
import socketserver
import time
import webbrowser
import zipfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR  = BASE_DIR / "web"
DATA_FILE = BASE_DIR / "data" / "autosave_intervals.json"
HOST = "127.0.0.1"
PORT = 8765

# ── Save analysis parsers ─────────────────────────────────────────────────────

_DATE_RE          = re.compile(rb'date\s*=\s*"?(\d{1,4}\.\d{1,2}\.\d{1,2})')
_COUNTRY_TAG_RE   = re.compile(rb'\n\t([A-Z][A-Z0-9]{2})=\{')
_UNITS_RE         = re.compile(rb'\bunits\s*=\s*\{')
_DIVISION_RE      = re.compile(rb'division\s*=\s*\{')
_OWNER_RE         = re.compile(rb'\bowner\s*=\s*"([A-Z][A-Z0-9]{2})"')
_FLEET_RE         = re.compile(rb'\bfleet\s*=\s*\{')
_TASK_FORCE_RE    = re.compile(rb'\btask_force\s*=\s*\{')
_SHIP_RE          = re.compile(rb'\bship\s*=\s*\{')
_LOGICAL_TAG_RE   = re.compile(rb'logical_country\s*=\s*"([A-Z][A-Z0-9]{2})"')
_AIR_WING_POOL_RE = re.compile(rb'\bair_wing_pool\s*=\s*\{')
_AIR_WINGS_RE     = re.compile(rb'\bair_wings\s*=\s*\{')
_COUNT_RE         = re.compile(rb'\bcount\s*=\s*(\d+)')
_TAG_IN_RE        = re.compile(rb'\btag\s*=\s*"([A-Z][A-Z0-9]{2})"')
_ARMY_MP_RE       = re.compile(rb'\barmy_manpower\s*=\s*\{')
_MP_VAL_RE        = re.compile(rb'\barmy_manpower_value\s*=\s*\{')
_MP_ENTRY_RE      = re.compile(
    rb'value\s*=\s*\{\s*tag\s*=\s*"([A-Z][A-Z0-9]{2})"\s*value\s*=\s*(\d+)\s*\}'
)
# Equipment lookup: equipment name → id (type=70 entities at root level)
_EQ_LOOKUP_RE  = re.compile(
    rb'^\t([a-z][a-z0-9_]+)\s*=\s*\{\s*\n\t\tid\s*=\s*\{\s*id\s*=\s*(\d+)\s*type\s*=\s*70\s*\}',
    re.MULTILINE,
)
# Equipment entries inside a division block
_EQ_ENTRY_RE   = re.compile(
    rb'equipment\s*=\s*\{\s*id\s*=\s*\{\s*id\s*=\s*(\d+)\s*type\s*=\s*70\s*\}\s*amount\s*=\s*([\d.]+)'
)


def _extract_block(content: bytes, start: int) -> tuple[bytes, int]:
    depth, pos = 1, start
    while pos < len(content) and depth:
        b = content[pos]
        if b == 123:  depth += 1
        elif b == 125: depth -= 1
        pos += 1
    return content[start:pos - 1], pos


def _read_save(path: str) -> bytes:
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            with zf.open(zf.namelist()[0]) as f:
                return f.read()
    with open(path, "rb") as f:
        return f.read()


def _analyze_save(path: str) -> dict:
    """Parse a HOI4 save and return per-country military stats."""
    t0      = time.perf_counter()
    content = _read_save(path)
    size_mb = round(len(content) / 1_048_576, 2)

    # Build equipment id → name lookup from root-level definitions
    eq_lookup: dict[int, str] = {}
    for m in _EQ_LOOKUP_RE.finditer(content):
        eq_id = int(m.group(2))
        if eq_id not in eq_lookup:
            eq_lookup[eq_id] = m.group(1).decode()

    # Game date
    dm = _DATE_RE.search(content[:20_000])
    game_date = dm.group(1).decode() if dm else "unknown"

    # Active countries (unique owners in states block)
    sm = re.search(rb'\nstates\s*=\s*\{', content)
    active_countries = 0
    if sm:
        sb, _ = _extract_block(content, sm.end())
        active_countries = len({m.group(1) for m in _OWNER_RE.finditer(sb)})

    # Per-country: divisions + manpower (countries block)
    div_by_owner:  dict[str, int] = {}
    mp_by_tag:     dict[str, int] = {}
    eq_by_country: dict[str, dict[str, float]] = {}

    cm = re.search(rb'\ncountries\s*=\s*\{', content)
    if cm:
        cb, _ = _extract_block(content, cm.end())
        country_ms = list(_COUNTRY_TAG_RE.finditer(cb))
        for idx, m in enumerate(country_ms):
            owner = m.group(1).decode()
            bs = m.end()
            be = country_ms[idx + 1].start() if idx + 1 < len(country_ms) else len(cb)
            country_block = cb[bs:be]
            for um in _UNITS_RE.finditer(country_block):
                ub, _ = _extract_block(country_block, um.end())
                for dm2 in _DIVISION_RE.finditer(ub):
                    db, _ = _extract_block(ub, dm2.end())
                    div_by_owner[owner] = div_by_owner.get(owner, 0) + 1
                    am = _ARMY_MP_RE.search(db)
                    if not am:
                        continue
                    amp, _ = _extract_block(db, am.end())
                    mv = _MP_VAL_RE.search(amp)
                    if not mv:
                        continue
                    vb, _ = _extract_block(amp, mv.end())
                    for e in _MP_ENTRY_RE.finditer(vb):
                        vtag = e.group(1).decode()
                        mp_by_tag[vtag] = mp_by_tag.get(vtag, 0) + int(e.group(2))

                    # Equipment inside this division
                    country_eq = eq_by_country.setdefault(owner, {})
                    for ee in _EQ_ENTRY_RE.finditer(db):
                        eq_id  = int(ee.group(1))
                        amount = float(ee.group(2))
                        name   = eq_lookup.get(eq_id, f"eq_{eq_id}")
                        country_eq[name] = country_eq.get(name, 0.0) + amount

    # Per-country ships (fleet → task_force, logical_country)
    ships_by_tag: dict[str, int] = {}
    for fm in _FLEET_RE.finditer(content):
        fb, _ = _extract_block(content, fm.end())
        for tm in _TASK_FORCE_RE.finditer(fb):
            tb, _ = _extract_block(fb, tm.end())
            cnt = len(_SHIP_RE.findall(tb))
            if not cnt:
                continue
            lm = _LOGICAL_TAG_RE.search(tb)
            tag = lm.group(1).decode() if lm else "???"
            ships_by_tag[tag] = ships_by_tag.get(tag, 0) + cnt

    # Per-country planes (air_wing_pool → air_wings, tag= inside)
    planes_by_tag: dict[str, int] = {}
    for pm in _AIR_WING_POOL_RE.finditer(content):
        pb, _ = _extract_block(content, pm.end())
        for aw in _AIR_WINGS_RE.finditer(pb):
            ab, _ = _extract_block(pb, aw.end())
            mc = _COUNT_RE.search(ab)
            if not mc:
                continue
            tm2 = _TAG_IN_RE.search(ab)
            tag = tm2.group(1).decode() if tm2 else "???"
            planes_by_tag[tag] = planes_by_tag.get(tag, 0) + int(mc.group(1))

    # Merge all tags
    all_tags = (div_by_owner.keys() | mp_by_tag.keys()
                | ships_by_tag.keys() | planes_by_tag.keys())
    by_country = []
    for tag in sorted(all_tags):
        divs  = div_by_owner.get(tag, 0)
        mp    = mp_by_tag.get(tag, 0)
        ships = ships_by_tag.get(tag, 0)
        planes = planes_by_tag.get(tag, 0)
        if divs or mp or ships or planes:
            by_country.append({
                "tag":         tag,
                "divisions":   divs,
                "manpower":    mp,
                "avg_manpower": round(mp / divs, 1) if divs else 0.0,
                "ships":       ships,
                "planes":      planes,
            })

    by_country.sort(key=lambda r: -r["manpower"])

    # Finalize equipment: convert floats to ints where possible, sort by amount desc
    for tag, eq_map in eq_by_country.items():
        eq_by_country[tag] = {
            k: int(v) if v == int(v) else round(v, 1)
            for k, v in sorted(eq_map.items(), key=lambda x: -x[1])
        }

    # World equipment totals
    world_equipment: dict[str, float] = {}
    for eq_map in eq_by_country.values():
        for k, v in eq_map.items():
            world_equipment[k] = world_equipment.get(k, 0) + v
    world_equipment = {
        k: int(v) if v == int(v) else round(v, 1)
        for k, v in sorted(world_equipment.items(), key=lambda x: -x[1])
    }

    return {
        "game_date":        game_date,
        "file_size_mb":     size_mb,
        "parse_seconds":    round(time.perf_counter() - t0, 2),
        "active_countries": active_countries,
        "total_divisions":  sum(r["divisions"] for r in by_country),
        "total_manpower":   sum(r["manpower"]  for r in by_country),
        "total_ships":      sum(r["ships"]     for r in by_country),
        "total_planes":     sum(r["planes"]    for r in by_country),
        "by_country":       by_country,
        "equipment_by_country": eq_by_country,
        "world_equipment":   world_equipment,
    }


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_GET(self):
        request_path = urlparse(self.path).path

        if request_path == "/api/records":
            self._serve_records()
            return
        if request_path == "/api/soldiers":
            self._serve_soldiers()
            return
        if request_path == "/api/health":
            self._serve_health()
            return
        if request_path in {"/", "/index.html"}:
            self.path = "/index.html"
        super().do_GET()

    def do_OPTIONS(self):
        """Handle CORS preflight for POST /api/analyze."""
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_POST(self):
        request_path = urlparse(self.path).path
        if request_path == "/api/analyze":
            self._serve_analyze()
            return
        self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
        self.end_headers()

    def _serve_analyze(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            req = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            req = {}

        path = str(req.get("path", "")).strip()
        if not path:
            self._json_error(HTTPStatus.BAD_REQUEST, 'Missing "path" field')
            return
        if not os.path.isfile(path):
            self._json_error(HTTPStatus.NOT_FOUND, f"File not found: {path}")
            return

        try:
            result = _analyze_save(path)
        except Exception as exc:
            self._json_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))
            return

        self._json_ok(result)

    def _json_ok(self, data: dict) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _json_error(self, status: HTTPStatus, message: str) -> None:
        payload = json.dumps({"error": message}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, format, *args):
        return

    def _serve_health(self):
        payload = json.dumps({"status": "ok"}).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_records(self):
        if not DATA_FILE.exists():
            payload = json.dumps({"records": [], "error": f"Missing file: {DATA_FILE.name}"}).encode("utf-8")
            self.send_response(HTTPStatus.NOT_FOUND)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        try:
            payload = DATA_FILE.read_bytes()
            json.loads(payload.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            error_payload = json.dumps({"records": [], "error": str(exc)}).encode("utf-8")
            self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(error_payload)))
            self.end_headers()
            self.wfile.write(error_payload)
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_soldiers(self):
        """Aggregate soldiers_by_country across all records into a timeline."""
        if not DATA_FILE.exists():
            payload = json.dumps({"error": f"Missing file: {DATA_FILE.name}", "timeline": []}).encode("utf-8")
            self.send_response(HTTPStatus.NOT_FOUND)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        try:
            data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            payload = json.dumps({"error": str(exc), "timeline": []}).encode("utf-8")
            self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        records = data.get("records", [])

        # Collect all tags that ever appeared
        all_tags: set[str] = set()
        for rec in records:
            sbc = rec.get("soldiers_by_country")
            if isinstance(sbc, dict):
                all_tags.update(sbc.keys())

        # Build per-tag time series (manpower only)
        tag_series: dict[str, list] = {tag: [] for tag in sorted(all_tags)}
        timeline: list[dict] = []

        for rec in records:
            entry = {
                "game_date": rec.get("game_date"),
                "real_time": rec.get("real_time"),
            }
            sbc = rec.get("soldiers_by_country") or {}
            for tag in sorted(all_tags):
                d = sbc.get(tag, {})
                entry[tag] = {
                    "divisions": d.get("divisions", 0),
                    "manpower":     d.get("manpower", 0),
                    "avg_manpower": d.get("avg_manpower", 0.0),
                }
            timeline.append(entry)

        # Latest snapshot sorted by manpower
        latest_sbc = {}
        for rec in reversed(records):
            sbc = rec.get("soldiers_by_country")
            if isinstance(sbc, dict) and sbc:
                latest_sbc = sbc
                break

        latest_ranked = sorted(
            [{"tag": tag, **v} for tag, v in latest_sbc.items()],
            key=lambda x: -x.get("manpower", 0),
        )

        result = {
            "tags":          sorted(all_tags),
            "timeline":      timeline,
            "latest_ranked": latest_ranked,
        }
        payload = json.dumps(result, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main() -> None:
    if not WEB_DIR.is_dir():
        raise SystemExit(f"Web directory not found: {WEB_DIR}")

    class ReusableTCPServer(socketserver.TCPServer):
        allow_reuse_address = True

    with ReusableTCPServer((HOST, PORT), DashboardHandler) as httpd:
        url = f"http://{HOST}:{PORT}"
        print("HOI4 Autosave Web Dashboard")
        print(f"  URL:  {url}")
        print(f"  Data: {DATA_FILE}")
        print("  Ctrl+C to stop.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping...")


if __name__ == "__main__":
    main()