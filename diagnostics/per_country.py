"""
HOI4 Per-Country Unit Counter
Считает дивизии, корабли и самолёты отдельно по каждой стране.
Помогает:
  1. Проверить точность парсера (сравни СССР с игровой статистикой)
  2. Найти откуда берутся лишние дивизии
"""

import re
import zipfile
import sys
import os
from collections import defaultdict

if len(sys.argv) > 1:
    path = sys.argv[1]
else:
    path = input("Путь к .hoi4 файлу: ").strip().strip('"')

def read_save(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            with zf.open(zf.namelist()[0]) as f:
                return f.read()
    with open(path, "rb") as f:
        return f.read()

print(f"\nЧитаю {os.path.basename(path)}...")
content = read_save(path)
print(f"Размер: {len(content)//1048576} МБ\n")

# ── Находим блок countries={ ... } ────────────────────────
# Ищем начало блока
m = re.search(rb'\ncountries=\{', content)
if not m:
    print("Блок countries={ не найден!")
    sys.exit(1)

# Находим весь блок countries через счётчик скобок
start = m.end()
depth = 1
pos = start
while pos < len(content) and depth > 0:
    b = content[pos]
    if b == ord('{'): depth += 1
    elif b == ord('}'): depth -= 1
    pos += 1
countries_block = content[start:pos]
print(f"Блок countries: {len(countries_block)//1048576} МБ\n")

# ── Парсим каждую страну ───────────────────────────────────
# Тег страны — строго 3 заглавные буквы или цифры: GER, SOV, USA, R01 и т.п.
COUNTRY_TAG_RE = re.compile(rb'\n\t([A-Z][A-Z0-9]{2})=\{')

stats = {}  # tag -> {divisions, ships, planes}

matches = list(COUNTRY_TAG_RE.finditer(countries_block))
print(f"Найдено стран: {len(matches)}\n")

for idx, m in enumerate(matches):
    tag = m.group(1).decode()
    # блок страны — от { до следующего тега страны или конца
    block_start = m.end()
    block_end   = matches[idx+1].start() if idx+1 < len(matches) else len(countries_block)
    block       = countries_block[block_start:block_end]

    # Дивизии — только внутри units={ ... }
    # Сначала извлекаем все блоки units={
    div_count = 0
    for um in re.finditer(rb'\bunits\s*=\s*\{', block):
        # считаем скобки чтобы взять содержимое units={...}
        u_start = um.end()
        depth2, end2 = 1, u_start
        while end2 < len(block) and depth2 > 0:
            b = block[end2]
            if b == ord('{'): depth2 += 1
            elif b == ord('}'): depth2 -= 1
            end2 += 1
        units_content = block[u_start:end2]
        div_count += len(re.findall(rb'division\s*=\s*\{', units_content))

    # Корабли — внутри navy={ ... }
    ship_count = 0
    for nm in re.finditer(rb'\bnavy\s*=\s*\{', block):
        n_start = nm.end()
        depth2, end2 = 1, n_start
        while end2 < len(block) and depth2 > 0:
            b = block[end2]
            if b == ord('{'): depth2 += 1
            elif b == ord('}'): depth2 -= 1
            end2 += 1
        navy_content = block[n_start:end2]
        ship_count += len(re.findall(rb'\bship\s*=\s*\{', navy_content))

    # Самолёты — сумма amount= внутри каждого air_wings={...equipment={amount=N}}
    plane_count = 0
    for am in re.finditer(rb'\bair_wings\s*=\s*\{', block):
        aw_start = am.end()
        depth2, end2 = 1, aw_start
        while end2 < len(block) and depth2 > 0:
            b = block[end2]
            if b == ord('{'): depth2 += 1
            elif b == ord('}'): depth2 -= 1
            end2 += 1
        aw_content = block[aw_start:end2]
        # amount= внутри equipment={ equipment={ amount=N } }
        for amt in re.findall(rb'\bamount\s*=\s*(\d+)', aw_content):
            plane_count += int(amt)

    if div_count > 0 or ship_count > 0 or plane_count > 0:
        stats[tag] = {"divisions": div_count, "ships": ship_count, "planes": plane_count}

# ── Вывод ─────────────────────────────────────────────────
print(f"{'Тег':<6} {'Дивизии':>9} {'Корабли':>9} {'Самолёты':>10}")
print("-" * 40)

total_div = total_ship = total_plane = 0
for tag, s in sorted(stats.items(), key=lambda x: -x[1]['divisions']):
    print(f"{tag:<6} {s['divisions']:>9} {s['ships']:>9} {s['planes']:>10}")
    total_div   += s['divisions']
    total_ship  += s['ships']
    total_plane += s['planes']

print("-" * 40)
print(f"{'ИТОГО':<6} {total_div:>9} {total_ship:>9} {total_plane:>10}")
print()

# Отдельно СССР
sov = stats.get("SOV")
if sov:
    print(f"СССР (SOV): {sov['divisions']} дивизий | {sov['ships']} кораблей | {sov['planes']} самолётов")
else:
    print("СССР (SOV) не найден в сейве.")
