"""
HOI4 Unit Count Tester v5
Запуск: python hoi4_unit_tester.py "путь/к/сейву.hoi4"
"""
import re, zipfile, sys, os, time
from collections import defaultdict

def read_save(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            with zf.open(zf.namelist()[0]) as f: return f.read()
    with open(path, "rb") as f: return f.read()

def extract_block(content, start_pos):
    depth, pos = 1, start_pos
    while pos < len(content) and depth > 0:
        b = content[pos]
        if b == ord('{'): depth += 1
        elif b == ord('}'): depth -= 1
        pos += 1
    return content[start_pos:pos-1], pos

SPOTLIGHT      = {"SOV", "USA"}
TAG_RE         = re.compile(rb'\btag\s*=\s*"([A-Z][A-Z0-9]{2})"')
LOGICAL_TAG_RE = re.compile(rb'logical_country\s*=\s*"([A-Z][A-Z0-9]{2})"')

path = sys.argv[1] if len(sys.argv) > 1 else input("Путь к .hoi4: ").strip().strip('"')
print(f"\nЧитаю {os.path.basename(path)} ({os.path.getsize(path)//1048576} МБ)...")
t0 = time.time()
content = read_save(path)

per = defaultdict(lambda: {"divisions": 0, "ships": 0, "planes": 0})

# ── Дивизии: первый большой countries={} → страны → units={} ──
cm = re.search(rb'\ncountries\s*=\s*\{', content)
if cm:
    countries_block, _ = extract_block(content, cm.end())
    if len(countries_block) > 1000:          # убеждаемся что это большой блок
        matches = list(re.finditer(rb'\n\t([A-Z][A-Z0-9]{2})=\{', countries_block))
        for idx, m in enumerate(matches):
            tag = m.group(1).decode()
            bs  = m.end()
            be  = matches[idx+1].start() if idx+1 < len(matches) else len(countries_block)
            cb  = countries_block[bs:be]
            for um in re.finditer(rb'\bunits\s*=\s*\{', cb):
                ub, _ = extract_block(cb, um.end())
                per[tag]["divisions"] += len(re.findall(rb'division\s*=\s*\{', ub))

# ── Корабли: fleet → task_force → ship, тег из logical_country ──
for fm in re.finditer(rb'\bfleet\s*=\s*\{', content):
    fb, _ = extract_block(content, fm.end())
    for tm in re.finditer(rb'\btask_force\s*=\s*\{', fb):
        tb, _ = extract_block(fb, tm.end())
        count = len(re.findall(rb'\bship\s*=\s*\{', tb))
        if count == 0:
            continue
        lm  = LOGICAL_TAG_RE.search(tb)
        tag = lm.group(1).decode() if lm else "???"
        per[tag]["ships"] += count

# ── Самолёты: глобально air_wing_pool → air_wings → count=
#    тег страны берём из tag= внутри каждого air_wings блока ──
for pm in re.finditer(rb'\bair_wing_pool\s*=\s*\{', content):
    pb, _ = extract_block(content, pm.end())
    for aw in re.finditer(rb'\bair_wings\s*=\s*\{', pb):
        ab, _ = extract_block(pb, aw.end())
        mc = re.search(rb'\bcount\s*=\s*(\d+)', ab)
        if not mc:
            continue
        tm2 = TAG_RE.search(ab)
        tag = tm2.group(1).decode() if tm2 else "???"
        per[tag]["planes"] += int(mc.group(1))

elapsed = round(time.time()-t0, 1)

total_div   = sum(v["divisions"] for v in per.values())
total_ships = sum(v["ships"]     for v in per.values())
total_plane = sum(v["planes"]    for v in per.values())

print(f"Готово за {elapsed} сек\n")
print("=" * 45)
print(f"  МИРОВОЙ ИТОГ")
print(f"  Дивизии:  {total_div}")
print(f"  Корабли:  {total_ships}")
print(f"  Самолёты: {total_plane}")
print("=" * 45)
print()
for tag in ["SOV", "USA"]:
    s     = per[tag]
    label = "СССР (SOV)" if tag == "SOV" else "США (USA) "
    print(f"  {label}  |  Дивизий: {s['divisions']}  "
          f"Кораблей: {s['ships']}  Самолётов: {s['planes']}")
print()
print("Сравни с внутриигровой статистикой.")