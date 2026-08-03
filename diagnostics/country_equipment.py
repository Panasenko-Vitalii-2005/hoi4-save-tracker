"""
HOI4 Country Equipment Report
Читает divisions_snapshot_*.json и выводит суммарное снаряжение
по каждой стране (сумма по всем дивизиям).

Запуск:
  python hoi4_country_equipment.py "divisions_snapshot_1959_4_1.json"
  python hoi4_country_equipment.py  ← возьмёт последний snapshot автоматически
"""
import json, sys, os, glob

# ── Найти файл ─────────────────────────────────────────────
if len(sys.argv) > 1:
    path = sys.argv[1].strip().strip('"')
else:
    # ищем последний divisions_snapshot_*.json в папке data/
    script_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    files = sorted(glob.glob(os.path.join(script_dir, "divisions_snapshot_*.json")))
    if not files:
        path = input("Путь к divisions_snapshot_*.json: ").strip().strip('"')
    else:
        path = files[-1]
        print(f"Авто-выбор: {os.path.basename(path)}")

with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

game_date       = data.get("game_date", "?")
total_divisions = data.get("total_divisions", "?")
by_country      = data.get("by_country", {})

print(f"\nДата: {game_date}  |  Дивизий: {total_divisions}\n")

# ── Собираем все типы снаряжения что встречаются в мире ────
all_eq_types = set()
for s in by_country.values():
    all_eq_types.update(s.get("equipment", {}).keys())
all_eq_types = sorted(all_eq_types)

# ── Вывод по каждой стране ─────────────────────────────────
for tag, s in by_country.items():
    divs     = s["divisions"]
    manpower = s["manpower"]
    eq       = s.get("equipment", {})
    if not eq:
        continue

    print("═" * 56)
    print(f"  {tag}  |  {divs} дивизий  |  {manpower:,} солдат")
    print("─" * 56)

    # Сортируем по количеству — самое многочисленное сверху
    for eq_name, amount in sorted(eq.items(), key=lambda x: -x[1]):
        bar_len = min(30, int(amount / max(eq.values()) * 30))
        bar = "█" * bar_len
        amt_str = f"{amount:,.1f}" if isinstance(amount, float) and amount != int(amount) else f"{int(amount):,}"
        print(f"  {eq_name:<40} {amt_str:>10}  {bar}")
    print()

# ── Мировой итог ───────────────────────────────────────────
world_eq = data.get("world_equipment", {})
if world_eq:
    print("═" * 56)
    print(f"  МИРОВОЙ ИТОГ")
    print("─" * 56)
    for eq_name, amount in sorted(world_eq.items(), key=lambda x: -x[1]):
        amt_str = f"{amount:,.1f}" if isinstance(amount, float) and amount != int(amount) else f"{int(amount):,}"
        print(f"  {eq_name:<40} {amt_str:>10}")
