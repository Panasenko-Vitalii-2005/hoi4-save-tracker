"""
HOI4 Industry Tester
Считает военные заводы (arms_factory), фабрики (industrial_complex)
и верфи (dockyard) по каждой стране через блок states={}.
Сравни вывод с тем что видишь в игре.
"""
import re, zipfile, sys, os, time
from collections import defaultdict

def read_save(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            with zf.open(zf.namelist()[0]) as f: return f.read()
    with open(path,"rb") as f: return f.read()

def extract_block(content, start_pos):
    depth, pos = 1, start_pos
    while pos < len(content) and depth > 0:
        b = content[pos]
        if b == ord('{'): depth += 1
        elif b == ord('}'): depth -= 1
        pos += 1
    return content[start_pos:pos-1], pos

OWNER_RE = re.compile(rb'\bowner\s*=\s*"([A-Z][A-Z0-9]{2})"')
LEVEL_RE = re.compile(rb'\blevel\s*=\s*(\d+)')

def get_building_level(state_block, building_name):
    """Ищет building_name={ level=N } и возвращает N."""
    pat = re.compile(rb'\b' + building_name + rb'\s*=\s*\{')
    m = pat.search(state_block)
    if not m:
        return 0
    block, _ = extract_block(state_block, m.end())
    lm = LEVEL_RE.search(block)
    return int(lm.group(1)) if lm else 0

path = sys.argv[1] if len(sys.argv) > 1 else input("Путь к .hoi4: ").strip().strip('"')
print(f"\nЧитаю {os.path.basename(path)} ({os.path.getsize(path)//1048576} МБ)...")
t0 = time.perf_counter()
content = read_save(path)

# Находим блок states={}
sm = re.search(rb'\nstates\s*=\s*\{', content)
if not sm:
    print("states={ не найден"); exit()
states_block, _ = extract_block(content, sm.end())
print(f"Блок states: {len(states_block)//1048576} МБ")

# Итерируем каждый штат: число={ ... }
STATE_RE = re.compile(rb'\n\t\d+\s*=\s*\{')
per = defaultdict(lambda: {"mil":0,"civ":0,"dock":0,"states":0})
total = {"mil":0,"civ":0,"dock":0,"states":0}

matches = list(STATE_RE.finditer(states_block))
for idx, m in enumerate(matches):
    bs = m.end()
    be = matches[idx+1].start() if idx+1 < len(matches) else len(states_block)
    sb = states_block[bs:be]

    om = OWNER_RE.search(sb)
    if not om:
        continue
    tag = om.group(1).decode()

    mil  = get_building_level(sb, b'arms_factory')
    civ  = get_building_level(sb, b'industrial_complex')
    dock = get_building_level(sb, b'dockyard')

    per[tag]["mil"]    += mil
    per[tag]["civ"]    += civ
    per[tag]["dock"]   += dock
    per[tag]["states"] += 1
    total["mil"]       += mil
    total["civ"]       += civ
    total["dock"]      += dock
    total["states"]    += 1

elapsed = round(time.perf_counter()-t0, 2)
print(f"Готово за {elapsed} сек  ({len(matches)} штатов)\n")

# Сортируем по mil+civ
ranked = sorted(per.items(), key=lambda x: -(x[1]['mil']+x[1]['civ']))

print(f"{'Тег':<6} {'Воен':>6} {'Гражд':>6} {'Верфи':>6} {'Штатов':>7}")
print("-" * 38)
for tag, s in ranked:
    if s['mil']+s['civ']+s['dock'] == 0: continue
    print(f"{tag:<6} {s['mil']:>6} {s['civ']:>6} {s['dock']:>6} {s['states']:>7}")
print("-" * 38)
print(f"{'ИТОГО':<6} {total['mil']:>6} {total['civ']:>6} {total['dock']:>6} {total['states']:>7}")
print()

for tag in ["SOV","USA","GER","ENG"]:
    s = per.get(tag)
    if s:
        print(f"  {tag}: воен={s['mil']}  гражд={s['civ']}  верфи={s['dock']}  штатов={s['states']}")
