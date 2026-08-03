"""
HOI4 Soldiers on Battlefield — per-country manpower counter

Считает живую силу на полях сражений по каждой стране через army_manpower_value.

Дивизии  — по стране-владельцу (блок units={} страны).
Живая сила — по тегу внутри army_manpower_value (точная атрибуция,
              включая экспедиционные войска под чужим флагом).

Запуск:
    python hoi4_soldiers_diagnose.py
    python hoi4_soldiers_diagnose.py "путь/к/сейву.hoi4"
"""

import re
import sys
import os
import time
import zipfile


# ── Чтение сейва ───────────────────────────────────────────────────────────────

def read_save(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            with zf.open(zf.namelist()[0]) as f:
                return f.read()
    with open(path, "rb") as f:
        return f.read()


# ── Вспомогательные функции ────────────────────────────────────────────────────

def extract_block(content, start_pos):
    depth, pos = 1, start_pos
    while pos < len(content) and depth > 0:
        b = content[pos]
        if b == 123:
            depth += 1
        elif b == 125:
            depth -= 1
        pos += 1
    return content[start_pos:pos - 1], pos


# ── Паттерны ───────────────────────────────────────────────────────────────────

COUNTRY_TAG_RE    = re.compile(rb'\n\t([A-Z][A-Z0-9]{2})=\{')
UNITS_RE          = re.compile(rb'\bunits\s*=\s*\{')
DIVISION_RE       = re.compile(rb'division\s*=\s*\{')
ARMY_MANPOWER_RE  = re.compile(rb'\barmy_manpower\s*=\s*\{')
MANPOWER_VAL_RE   = re.compile(rb'\barmy_manpower_value\s*=\s*\{')
MANPOWER_ENTRY_RE = re.compile(
    rb'value\s*=\s*\{\s*tag\s*=\s*"([A-Z][A-Z0-9]{2})"\s*value\s*=\s*(\d+)\s*\}'
)
DATE_RE = re.compile(rb'date\s*=\s*"?(\d{1,4}\.\d{1,2}\.\d{1,2})')


# ── Основной парсер ────────────────────────────────────────────────────────────

def count_soldiers(content):
    """
    Возвращает:
      div_by_owner  — {tag: divisions}   по блоку units={} страны-владельца
      mp_by_tag     — {tag: manpower}    по тегу внутри army_manpower_value
      no_manpower   — {tag: count}       дивизии без army_manpower_value (гарнизоны/шаблоны)
    """
    div_by_owner = {}
    mp_by_tag    = {}
    no_manpower  = {}

    cm = re.search(rb'\ncountries\s*=\s*\{', content)
    if not cm:
        return div_by_owner, mp_by_tag, no_manpower

    countries_block, _ = extract_block(content, cm.end())
    if len(countries_block) < 1000:
        return div_by_owner, mp_by_tag, no_manpower

    country_matches = list(COUNTRY_TAG_RE.finditer(countries_block))
    for idx, m in enumerate(country_matches):
        owner = m.group(1).decode()
        bs = m.end()
        be = (country_matches[idx + 1].start()
              if idx + 1 < len(country_matches) else len(countries_block))
        country_block = countries_block[bs:be]

        for um in UNITS_RE.finditer(country_block):
            units_block, _ = extract_block(country_block, um.end())
            for dm in DIVISION_RE.finditer(units_block):
                div_block, _ = extract_block(units_block, dm.end())

                div_by_owner[owner] = div_by_owner.get(owner, 0) + 1

                am = ARMY_MANPOWER_RE.search(div_block)
                if not am:
                    no_manpower[owner] = no_manpower.get(owner, 0) + 1
                    continue

                amp_block, _ = extract_block(div_block, am.end())
                mv = MANPOWER_VAL_RE.search(amp_block)
                if not mv:
                    no_manpower[owner] = no_manpower.get(owner, 0) + 1
                    continue

                val_block, _ = extract_block(amp_block, mv.end())
                for entry in MANPOWER_ENTRY_RE.finditer(val_block):
                    vtag = entry.group(1).decode()
                    vval = int(entry.group(2))
                    mp_by_tag[vtag] = mp_by_tag.get(vtag, 0) + vval

    return div_by_owner, mp_by_tag, no_manpower


# ── Главная часть ──────────────────────────────────────────────────────────────

def main():
    # Путь к файлу
    if len(sys.argv) > 1:
        path = sys.argv[1].strip().strip('"')
    else:
        default = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "..", "saves", "autosave_temp.hoi4")
        if os.path.exists(default):
            path = default
            print(f"Файл не указан, использую: {default}\n")
        else:
            path = input("Путь к .hoi4 файлу: ").strip().strip('"')

    if not os.path.exists(path):
        print(f"Файл не найден: {path}")
        sys.exit(1)

    size_mb = os.path.getsize(path) / 1048576
    print(f"Читаю {os.path.basename(path)}  ({size_mb:.1f} МБ)...")

    t0 = time.perf_counter()
    content = read_save(path)

    # Игровая дата
    dm = DATE_RE.search(content[:20000])
    game_date = dm.group(1).decode() if dm else "?"

    div_by_owner, mp_by_tag, no_manpower = count_soldiers(content)
    elapsed = round(time.perf_counter() - t0, 2)

    # Объединяем все теги
    all_tags = div_by_owner.keys() | mp_by_tag.keys()
    rows = []
    for tag in all_tags:
        divs = div_by_owner.get(tag, 0)
        mp   = mp_by_tag.get(tag, 0)
        no_mp = no_manpower.get(tag, 0)
        avg  = round(mp / divs, 0) if divs > 0 else 0
        rows.append((tag, divs, mp, avg, no_mp))

    # Сортировка по живой силе
    rows.sort(key=lambda r: -r[2])

    total_divs = sum(r[1] for r in rows)
    total_mp   = sum(r[2] for r in rows)
    total_no_mp = sum(r[4] for r in rows)

    print(f"\nДата: {game_date}   Парсинг: {elapsed}с\n")
    print(f"{'Тег':<6}  {'Дивизий':>9}  {'Живая сила':>14}  {'Avg/дивизию':>13}  {'Без данных':>11}")
    print("─" * 62)
    for tag, divs, mp, avg, no_mp in rows:
        no_mp_str = f"  ({no_mp})" if no_mp else ""
        print(f"{tag:<6}  {divs:>9,}  {mp:>14,}  {avg:>13,.0f}{no_mp_str}")

    print("─" * 62)
    print(f"{'ИТОГО':<6}  {total_divs:>9,}  {total_mp:>14,}")
    print(f"\nВсего стран с армиями: {len(rows)}")
    print(f"Дивизий без army_manpower_value: {total_no_mp}  (гарнизоны / шаблоны)")

    # Топ-5 отдельно
    print("\n── Топ-10 по живой силе ──────────────────────────────────────────────")
    print(f"{'#':<3}  {'Тег':<6}  {'Живая сила':>14}  {'Дивизий':>9}  {'Avg/дивизию':>13}")
    print("─" * 52)
    for i, (tag, divs, mp, avg, _) in enumerate(rows[:10], 1):
        print(f"{i:<3}  {tag:<6}  {mp:>14,}  {divs:>9,}  {avg:>13,.0f}")


if __name__ == "__main__":
    main()
