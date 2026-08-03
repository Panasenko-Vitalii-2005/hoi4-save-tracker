"""
HOI4 Division Snapshot Parser
================================
Берёт один .hoi4 сейв и выдаёт полный срез всех дивизий:
  - страна
  - организация, сила, снабжение, опыт
  - личный состав (текущий / требуемый / % укомплектования)
  - снаряжение по типам (infantry_equipment_1: 765, artillery_equipment_1: 10 ...)

Вывод: divisions_snapshot_<game_date>.json

Запуск:
  python hoi4_divisions_snapshot.py "путь\\до\\save.hoi4"
"""

import json, re, zipfile, sys, os, time
from collections import defaultdict

# ── Чтение сейва ───────────────────────────────────────────

def read_save(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            with zf.open(zf.namelist()[0]) as f: return f.read()
    with open(path, "rb") as f: return f.read()


# ── Извлечение блока ───────────────────────────────────────

def extract_block(content, start_pos):
    depth, pos = 1, start_pos
    n = len(content)
    while pos < n and depth > 0:
        b = content[pos]
        if b == 123: depth += 1    # ord('{')
        elif b == 125: depth -= 1  # ord('}')
        pos += 1
    return content[start_pos:pos - 1], pos


# ── Lookup: equipment id → название ────────────────────────

EQ_LOOKUP_RE = re.compile(
    rb'^\t([a-z][a-z0-9_]+)\s*=\s*\{\s*\n\t\tid\s*=\s*\{\s*id\s*=\s*(\d+)\s*type\s*=\s*70\s*\}',
    re.MULTILINE
)

def build_equipment_lookup(content):
    """id (int) → equipment_name (str)"""
    lookup = {}
    for m in EQ_LOOKUP_RE.finditer(content):
        name  = m.group(1).decode()
        eq_id = int(m.group(2))
        if eq_id not in lookup:          # первое вхождение — базовый вариант
            lookup[eq_id] = name
    return lookup


# ── Паттерны для парсинга дивизий ──────────────────────────

DATE_RE         = re.compile(rb'date\s*=\s*"?(\d{1,4}\.\d{1,2}\.\d{1,2})')
COUNTRY_TAG_RE  = re.compile(rb'\n\t([A-Z][A-Z0-9]{2})=\{')
UNITS_RE        = re.compile(rb'\bunits\s*=\s*\{')
DIVISION_RE     = re.compile(rb'division\s*=\s*\{')

# Поля дивизии
_F = {
    "organisation":             re.compile(rb'\borganisation\s*=\s*([\d.]+)'),
    "strength":                 re.compile(rb'\bstrength\s*=\s*([\d.]+)'),
    "supply_ratio":             re.compile(rb'\barmy_current_supply_ratio\s*=\s*([\d.]+)'),
    "experience":               re.compile(rb'\bexperience\s*=\s*([\d.]+)'),
    "dig_in":                   re.compile(rb'\bdig_in\s*=\s*([\d.]+)'),
    "manpower_current":         re.compile(rb'army_manpower_value\s*=\s*\{[^}]*value\s*=\s*\{[^}]*value\s*=\s*([\d.]+)'),
    "manpower_needed":          re.compile(rb'army_manpower_need\s*=\s*\{[^}]*value\s*=\s*\{[^}]*value\s*=\s*([\d.]+)'),
    "template_id":              re.compile(rb'division_template_id\s*=\s*\{\s*id\s*=\s*(\d+)'),
    "logical_country":          re.compile(rb'\blogical_country\s*=\s*"([A-Z][A-Z0-9]{2})"'),
}

EQ_ENTRY_RE = re.compile(
    rb'equipment\s*=\s*\{\s*id\s*=\s*\{\s*id\s*=\s*(\d+)\s*type\s*=\s*\d+\s*\}\s*amount\s*=\s*([\d.]+)'
)

def parse_division(div_block, eq_lookup, country_tag):
    rec = {"country": country_tag}

    for field, pat in _F.items():
        m = pat.search(div_block)
        if m:
            raw = m.group(1).decode()
            if field in ("logical_country",):
                rec[field] = raw
            elif field == "template_id":
                rec[field] = int(raw)
            else:
                try:
                    v = float(raw)
                    rec[field] = int(v) if v == int(v) else round(v, 2)
                except ValueError:
                    rec[field] = raw

    # Укомплектованность личным составом
    cur = rec.get("manpower_current")
    ned = rec.get("manpower_needed")
    if cur is not None and ned and ned > 0:
        rec["manpower_pct"] = round(cur / ned * 100, 1)

    # Снаряжение: суммируем по типу (у дивизии может быть несколько
    # equipment-записей одного типа — складываем)
    equipment = defaultdict(float)
    for em in EQ_ENTRY_RE.finditer(div_block):
        eq_id  = int(em.group(1))
        amount = float(em.group(2))
        name   = eq_lookup.get(eq_id, f"eq_{eq_id}")
        equipment[name] += amount

    if equipment:
        rec["equipment"] = {
            k: int(v) if v == int(v) else round(v, 1)
            for k, v in sorted(equipment.items())
        }

    return rec


# ── Главная функция парсинга ────────────────────────────────

def parse_all_divisions(content, eq_lookup):
    cm = re.search(rb'\ncountries\s*=\s*\{', content)
    if not cm:
        return []

    countries_block, _ = extract_block(content, cm.end())
    if len(countries_block) < 1000:
        return []

    divisions = []
    country_matches = list(COUNTRY_TAG_RE.finditer(countries_block))

    for idx, cm2 in enumerate(country_matches):
        tag = cm2.group(1).decode()
        bs  = cm2.end()
        be  = country_matches[idx + 1].start() if idx + 1 < len(country_matches) else len(countries_block)
        cb  = countries_block[bs:be]

        for um in UNITS_RE.finditer(cb):
            ub, _ = extract_block(cb, um.end())
            for dm in DIVISION_RE.finditer(ub):
                db, _ = extract_block(ub, dm.end())
                div = parse_division(db, eq_lookup, tag)
                divisions.append(div)

    return divisions


# ── Агрегированная статистика ───────────────────────────────

def make_summary(divisions):
    by_country = defaultdict(lambda: {
        "divisions": 0, "manpower": 0, "equipment": defaultdict(float)
    })
    total_eq = defaultdict(float)

    for d in divisions:
        tag = d.get("country", "???")
        by_country[tag]["divisions"] += 1
        by_country[tag]["manpower"] += d.get("manpower_current", 0)
        for eq, amt in d.get("equipment", {}).items():
            by_country[tag]["equipment"][eq] += amt
            total_eq[eq] += amt

    # Сериализуем defaultdict → dict
    summary_by_country = {}
    for tag, s in sorted(by_country.items(), key=lambda x: -x[1]["divisions"]):
        summary_by_country[tag] = {
            "divisions": s["divisions"],
            "manpower":  int(s["manpower"]),
            "equipment": {k: int(v) if v == int(v) else round(v,1)
                          for k, v in sorted(s["equipment"].items())}
        }

    world_eq = {k: int(v) if v == int(v) else round(v,1)
                for k, v in sorted(total_eq.items())}

    return summary_by_country, world_eq


# ── Точка входа ─────────────────────────────────────────────

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else input("Путь к .hoi4: ").strip().strip('"')

    print(f"\nЧитаю {os.path.basename(path)} ({os.path.getsize(path)//1048576} МБ)...")
    t0      = time.perf_counter()
    content = read_save(path)

    print("Строю lookup снаряжения...")
    eq_lookup = build_equipment_lookup(content)
    print(f"  {len(eq_lookup)} уникальных ID снаряжения")

    date_m    = DATE_RE.search(content[:20000])
    game_date = date_m.group(1).decode() if date_m else "unknown"
    print(f"  Игровая дата: {game_date}")

    print("Парсю дивизии...")
    divisions = parse_all_divisions(content, eq_lookup)
    print(f"  Найдено: {len(divisions)} дивизий")

    print("Строю сводку по странам...")
    summary_by_country, world_equipment = make_summary(divisions)

    elapsed = round(time.perf_counter() - t0, 2)

    out = {
        "game_date":        game_date,
        "source_file":      os.path.basename(path),
        "parse_seconds":    elapsed,
        "total_divisions":  len(divisions),
        "world_equipment":  world_equipment,
        "by_country":       summary_by_country,
        "divisions":        divisions,
    }

    out_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "data",
        f"divisions_snapshot_{game_date.replace('.','_')}.json"
    )
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"\nГотово за {elapsed} сек")
    print(f"Файл: {out_path}")
    print(f"\nТоп-10 стран по дивизиям:")
    print(f"  {'Тег':<6} {'Дивизий':>8} {'Манпауэр':>10}")
    print("  " + "-" * 28)
    for tag, s in list(summary_by_country.items())[:10]:
        print(f"  {tag:<6} {s['divisions']:>8} {s['manpower']:>10,}")
    print(f"\n  Мировое снаряжение (топ-10 типов по количеству):")
    for eq, amt in sorted(world_equipment.items(), key=lambda x: -x[1])[:10]:
        print(f"    {eq:<40} {amt:>10,}")


if __name__ == "__main__":
    main()