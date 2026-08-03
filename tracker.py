"""
HOI4 Autosave Tracker v5
=========================
Для каждого автосохранения фиксирует:
  - реальное время записи (после стабилизации размера файла)
  - размер файла (байты и МБ)
  - длительность и скорость записи файла
  - игровую дату из сейва
  - интервал с предыдущим автосейвом (сек, human, сек/игровой день)
  - CPU% (avg/max) и RAM (avg/max) процесса hoi4.exe — снимаются в фоне
    каждые 75 мс именно во время записи файла, а не после
  - дивизии  — только внутри units={} каждой страны
  - армии    — количество units={} блоков (групп армий)
  - корабли  — только ship={} внутри task_force={} → fleet={}
  - самолёты — сумма count= в air_wings={} внутри air_wing_pool={}
  - живые страны — количество стран с exists=yes в сейве

Зависимости:
    pip install watchdog psutil

Запуск:
    python hoi4_autosave_tracker.py
"""

import json
import os
import re
import threading
import time
import zipfile
from datetime import datetime

import psutil
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ──────────────────── НАСТРОЙКИ ────────────────────────────

SAVE_DIR        = r"C:\Users\panas\OneDrive\Документы\Paradox Interactive\Hearts of Iron IV\save games"
TARGET_FILENAME = "autosave_temp.hoi4"
OUTPUT_JSON     = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "autosave_intervals.json")

DEBOUNCE_SECONDS       = 5
STABLE_POLL_INTERVAL   = 0.075
STABLE_REQUIRED_CHECKS = 3
STABLE_TIMEOUT         = 30

HOI4_PROCESS_NAME  = "hoi4.exe"
RESOURCE_POLL_MS   = 75        # интервал опроса CPU/RAM во время записи, мс

# ───────────────────────────────────────────────────────────


# ── Утилиты ────────────────────────────────────────────────

def load_existing_data():
    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, "r", encoding="utf-8") as f:
                return json.load(f).get("records", [])
        except (json.JSONDecodeError, OSError):
            print("Не удалось прочитать JSON, начинаю заново.")
    return []


def save_data(records):
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(
            {"records": records,
             "last_updated": datetime.now().isoformat(timespec="seconds")},
            f, ensure_ascii=False, indent=2
        )


def format_interval(seconds):
    h, r = divmod(int(seconds), 3600)
    m, s = divmod(r, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


# ── Мониторинг ресурсов в фоновом потоке ───────────────────

class ResourceMonitor:
    """
    Запускается в момент первого события записи файла и работает
    пока не вызван stop(). Снимает CPU% и RAM каждые RESOURCE_POLL_MS мс.
    Итог: avg/max CPU и avg/max RAM за весь период записи.
    """

    def __init__(self, proc):
        self.proc    = proc
        self._stop   = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self.cpu_samples: list[float] = []
        self.ram_samples: list[float] = []

    def start(self):
        if self.proc:
            # Первый вызов cpu_percent всегда возвращает 0 (артефакт psutil).
            # Делаем один прогревочный вызов здесь — до запуска потока,
            # чтобы все последующие сэмплы были честными (включая нули).
            try:
                self.proc.cpu_percent(interval=None)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._thread.join(timeout=2)

    def _run(self):
        interval = RESOURCE_POLL_MS / 1000
        while not self._stop.is_set():
            if self.proc:
                try:
                    cpu = self.proc.cpu_percent(interval=None)
                    ram = self.proc.memory_info().rss / 1048576
                    self.cpu_samples.append(cpu)   # нули допустимы — прогрев уже сделан
                    self.ram_samples.append(ram)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    break
            self._stop.wait(interval)

    def result(self):
        def stats(samples):
            if not samples:
                return None, None
            return round(sum(samples) / len(samples), 1), round(max(samples), 1)

        cpu_avg, cpu_max = stats(self.cpu_samples)
        ram_avg, ram_max = stats(self.ram_samples)
        return {
            "cpu_avg":          cpu_avg,
            "cpu_max":          cpu_max,
            "ram_avg":          ram_avg,
            "ram_max":          ram_max,
            "resource_samples": len(self.cpu_samples),
        }


# ── Стабилизация файла + измерение скорости записи ─────────

def wait_for_stable_size(path):
    """
    Ждёт стабилизации размера файла.
    Возвращает (final_size, write_start_time, write_end_time).
    write_start_time — момент первого ненулевого размера (начало реальной записи).
    write_end_time   — момент стабилизации (запись завершена).
    """
    last_size     = -1
    stable_count  = 0
    write_started = None
    start         = time.perf_counter()

    while time.perf_counter() - start < STABLE_TIMEOUT:
        try:
            size = os.path.getsize(path)
        except OSError:
            time.sleep(STABLE_POLL_INTERVAL)
            continue

        if size > 0 and write_started is None:
            write_started = time.perf_counter()

        if size == last_size:
            stable_count += 1
            if stable_count >= STABLE_REQUIRED_CHECKS:
                return size, write_started or start, time.perf_counter()
        else:
            stable_count, last_size = 0, size

        time.sleep(STABLE_POLL_INTERVAL)

    return last_size, write_started or start, time.perf_counter()


# ── Чтение сейва ───────────────────────────────────────────

def read_save_bytes(path):
    try:
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as zf:
                with zf.open(zf.namelist()[0]) as f:
                    return f.read()
        with open(path, "rb") as f:
            return f.read()
    except (OSError, zipfile.BadZipFile):
        return b""


# ── Паттерны ───────────────────────────────────────────────

DATE_RE          = re.compile(rb'date\s*=\s*"?(\d{1,4}\.\d{1,2}\.\d{1,2})')
COUNTRY_TAG_RE   = re.compile(rb'\n\t([A-Z][A-Z0-9]{2})=\{')
UNITS_RE         = re.compile(rb'\bunits\s*=\s*\{')
DIVISION_RE      = re.compile(rb'division\s*=\s*\{')
EXISTS_YES_RE    = re.compile(rb'\bexists\s*=\s*yes\b')
TASK_FORCE_RE    = re.compile(rb'\btask_force\s*=\s*\{')
SHIP_RE          = re.compile(rb'\bship\s*=\s*\{')
AIR_WING_POOL_RE = re.compile(rb'\bair_wing_pool\s*=\s*\{')
AIR_WINGS_RE     = re.compile(rb'\bair_wings\s*=\s*\{')
COUNT_RE         = re.compile(rb'\bcount\s*=\s*(\d+)')
FLEET_RE         = re.compile(rb'\bfleet\s*=\s*\{')
OWNER_RE         = re.compile(rb'\bowner\s*=\s*"([A-Z][A-Z0-9]{2})"')
STRENGTH_RE      = re.compile(rb'\bstrength\s*=\s*([\d.]+)')
ARMY_MANPOWER_RE = re.compile(rb'\barmy_manpower\s*=\s*\{')
MANPOWER_VAL_RE  = re.compile(rb'\barmy_manpower_value\s*=\s*\{')
MANPOWER_ENTRY_RE = re.compile(rb'value\s*=\s*\{\s*tag\s*=\s*"([A-Z][A-Z0-9]{2})"\s*value\s*=\s*(\d+)\s*\}')


# ── Парсеры ────────────────────────────────────────────────

def extract_block(content, start_pos):
    depth, pos = 1, start_pos
    while pos < len(content) and depth > 0:
        b = content[pos]
        if b == ord('{'):   depth += 1
        elif b == ord('}'): depth -= 1
        pos += 1
    return content[start_pos:pos - 1], pos


def extract_game_date(content):
    m = DATE_RE.search(content[:20000])
    return m.group(1).decode() if m else None


def parse_countries_block(content):
    """
    Возвращает (divisions, army_groups, active_countries) из первого
    большого блока countries={}.
    Один проход — три метрики бесплатно.
    """
    divisions      = 0
    army_groups    = 0
    active_countries = 0

    cm = re.search(rb'\ncountries\s*=\s*\{', content)
    if not cm:
        return divisions, army_groups, active_countries

    countries_block, _ = extract_block(content, cm.end())
    if len(countries_block) < 1000:
        return divisions, army_groups, active_countries

    matches = list(COUNTRY_TAG_RE.finditer(countries_block))
    for idx, m in enumerate(matches):
        bs = m.end()
        be = matches[idx + 1].start() if idx + 1 < len(matches) else len(countries_block)
        cb = countries_block[bs:be]

        # В новых форматах сейва exists=yes может отсутствовать.
        # Если поле есть, считаем по нему (старое поведение).
        if EXISTS_YES_RE.search(cb):
            active_countries += 1

        # units={} — армейские группы и дивизии внутри них
        for um in UNITS_RE.finditer(cb):
            army_groups += 1
            ub, _ = extract_block(cb, um.end())
            divisions += len(DIVISION_RE.findall(ub))

    return divisions, army_groups, active_countries


def count_active_countries_from_states(content):
    """
    Надёжный подсчёт живых стран через блок states={}: уникальные owner="TAG".
    Для текущего формата сейва HOI4 это стабильнее, чем exists=yes (которого может не быть вовсе).
    """
    sm = re.search(rb'\nstates\s*=\s*\{', content)
    if not sm:
        return 0

    states_block, _ = extract_block(content, sm.end())
    owners = {m.group(1) for m in OWNER_RE.finditer(states_block)}
    return len(owners)


def get_file_signature(path):
    """Сигнатура файла для отсечения повторных watchdog-событий одного и того же сейва."""
    try:
        st = os.stat(path)
        return st.st_mtime_ns, st.st_size
    except OSError:
        return None


def count_soldiers_per_country(content):
    """
    Возвращает {tag: {"divisions": N, "manpower": X, "avg_manpower": Y}}.

    divisions — все дивизии страны (по блоку units={} страны-владельца).
    manpower  — сумма army_manpower_value по тегу внутри блока (точная атрибуция:
                экспедиционные/добровольческие войска учитываются на своей стране).
    """
    # Раздельные словари: дивизии — по стране-владельцу, живая сила — по тегу внутри army_manpower_value
    div_by_owner: dict[str, int] = {}      # owner_tag -> division count
    mp_by_tag:    dict[str, int] = {}      # vtag      -> manpower sum

    cm = re.search(rb'\ncountries\s*=\s*\{', content)
    if not cm:
        return {}

    countries_block, _ = extract_block(content, cm.end())
    if len(countries_block) < 1000:
        return {}

    country_matches = list(COUNTRY_TAG_RE.finditer(countries_block))
    for idx, m in enumerate(country_matches):
        owner = m.group(1).decode()
        bs = m.end()
        be = country_matches[idx + 1].start() if idx + 1 < len(country_matches) else len(countries_block)
        country_block = countries_block[bs:be]

        for um in UNITS_RE.finditer(country_block):
            units_block, _ = extract_block(country_block, um.end())
            for dm in DIVISION_RE.finditer(units_block):
                div_block, _ = extract_block(units_block, dm.end())

                # Count this division under the owning country
                div_by_owner[owner] = div_by_owner.get(owner, 0) + 1

                # Accumulate manpower by the tag inside army_manpower_value
                am = ARMY_MANPOWER_RE.search(div_block)
                if not am:
                    continue
                amp_block, _ = extract_block(div_block, am.end())
                mv = MANPOWER_VAL_RE.search(amp_block)
                if not mv:
                    continue
                val_block, _ = extract_block(amp_block, mv.end())
                for entry in MANPOWER_ENTRY_RE.finditer(val_block):
                    vtag = entry.group(1).decode()
                    vval = int(entry.group(2))
                    mp_by_tag[vtag] = mp_by_tag.get(vtag, 0) + vval

    # Merge: include every tag that has either divisions or manpower
    all_tags = div_by_owner.keys() | mp_by_tag.keys()
    result = {}
    for tag in all_tags:
        divisions = div_by_owner.get(tag, 0)
        manpower  = mp_by_tag.get(tag, 0)
        if divisions > 0 or manpower > 0:
            result[tag] = {
                "divisions":    divisions,
                "manpower":     manpower,
                "avg_manpower": round(manpower / divisions, 1) if divisions > 0 else 0.0,
            }
    return result


def count_ships(content):
    total = 0
    for fm in FLEET_RE.finditer(content):
        fb, _ = extract_block(content, fm.end())
        for tm in TASK_FORCE_RE.finditer(fb):
            tb, _ = extract_block(fb, tm.end())
            total += len(SHIP_RE.findall(tb))
    return total


def count_planes(content):
    total = 0
    for pm in AIR_WING_POOL_RE.finditer(content):
        pb, _ = extract_block(content, pm.end())
        for aw in AIR_WINGS_RE.finditer(pb):
            ab, _ = extract_block(pb, aw.end())
            m = COUNT_RE.search(ab)
            if m:
                total += int(m.group(1))
    return total


def game_date_to_days(date_str):
    if not date_str:
        return None
    try:
        y, mo, d = (int(x) for x in date_str.split("."))
        return y * 360 + mo * 30 + d
    except ValueError:
        return None


# ── HOI4 процесс ───────────────────────────────────────────

def get_hoi4_process():
    for proc in psutil.process_iter(["name"]):
        try:
            if proc.info["name"] and proc.info["name"].lower() == HOI4_PROCESS_NAME.lower():
                return proc
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return None


# ── Обработчик событий ─────────────────────────────────────

class AutosaveHandler(FileSystemEventHandler):
    def __init__(self):
        super().__init__()
        self.records         = load_existing_data()
        self.last_event_time = 0.0
        self.hoi4_proc       = get_hoi4_process()
        self.last_processed_signature = None
        if self.records:
            print(f"Загружено {len(self.records)} ранее записанных автосохранений.\n")

    def _target_path(self):
        return os.path.join(SAVE_DIR, TARGET_FILENAME)

    def on_modified(self, event): self._handle(event)
    def on_created(self, event):  self._handle(event)

    def _handle(self, event):
        if event.is_directory:
            return
        if os.path.abspath(event.src_path) != os.path.abspath(self._target_path()):
            return

        path = self._target_path()

        # Дубликат события на уже обработанный файл (частый кейс у watchdog на Windows).
        current_sig = get_file_signature(path)
        if current_sig and current_sig == self.last_processed_signature:
            return

        now = time.time()
        if now - self.last_event_time < DEBOUNCE_SECONDS:
            return
        self.last_event_time = now

        # Ищем процесс игры если ещё не нашли
        if self.hoi4_proc is None:
            self.hoi4_proc = get_hoi4_process()

        # Запускаем мониторинг ресурсов в фоне — он работает пока пишется файл
        monitor = ResourceMonitor(self.hoi4_proc)
        monitor.start()

        print(f"[{datetime.now().strftime('%H:%M:%S')}] Обнаружено событие, жду стабилизации...")

        final_size, write_start, write_end = wait_for_stable_size(path)

        final_sig = get_file_signature(path)
        if final_sig and final_sig == self.last_processed_signature:
            monitor.stop()
            return

        # Запись завершена — останавливаем мониторинг
        monitor.stop()
        res = monitor.result()

        save_complete      = datetime.now()
        write_duration     = round(write_end - write_start, 2)
        file_size_mb       = round(final_size / 1048576, 2)
        write_speed        = round(file_size_mb / write_duration, 2) if write_duration > 0 else None

        print(f"        Файл {file_size_mb} МБ, запись {write_duration}с "
              f"({write_speed} МБ/с), образцов CPU: {res['resource_samples']}")
        print(f"        Читаю сейв, считаю юниты...")

        t0      = time.perf_counter()
        content = read_save_bytes(path)
        game_date = extract_game_date(content)
        divisions, army_groups, active_countries_legacy = parse_countries_block(content)
        active_countries = count_active_countries_from_states(content)
        if active_countries == 0:
            active_countries = active_countries_legacy
        ships   = count_ships(content)
        planes  = count_planes(content)
        soldiers_by_country = count_soldiers_per_country(content)
        parse_sec = round(time.perf_counter() - t0, 2)

        record = {
            # время и файл
            "real_time":              save_complete.isoformat(timespec="seconds"),
            "file_size_bytes":        final_size,
            "file_size_mb":           file_size_mb,
            "write_duration_seconds": write_duration,
            "write_speed_mb_per_sec": write_speed,
            "game_date":              game_date,
            # ресурсы во время записи
            "cpu_avg":                res["cpu_avg"],
            "cpu_max":                res["cpu_max"],
            "ram_avg":                res["ram_avg"],
            "ram_max":                res["ram_max"],
            "resource_samples":       res["resource_samples"],
            # юниты и страны
            "divisions":              divisions,
            "army_groups":            army_groups,
            "ships":                  ships,
            "planes":                 planes,
            "active_countries":       active_countries,
            "soldiers_by_country":    soldiers_by_country,
            # парсинг
            "parse_seconds":          parse_sec,
            # интервалы — заполняются ниже
            "interval_seconds":       None,
            "interval_human":         None,
            "game_days_passed":       None,
            "seconds_per_game_day":   None,
        }

        if self.records:
            prev    = self.records[-1]
            prev_dt = datetime.fromisoformat(prev["real_time"])
            delta   = (save_complete - prev_dt).total_seconds()
            record["interval_seconds"] = round(delta, 1)
            record["interval_human"]   = format_interval(delta)

            prev_days = game_date_to_days(prev.get("game_date"))
            curr_days = game_date_to_days(game_date)
            if prev_days and curr_days and curr_days > prev_days:
                days = curr_days - prev_days
                record["game_days_passed"]     = days
                record["seconds_per_game_day"] = round(delta / days, 2)

            spd = record["seconds_per_game_day"]
            print(f"        Дата: {game_date}  |  {record['interval_human']} "
                  f"({record['interval_seconds']} сек)")
            print(f"        {f'{spd} сек/игр.день' if spd else '—'}")
            print(f"        Дивизий: {divisions} (армий: {army_groups})  "
                  f"Кораблей: {ships}  Самолётов: {planes}  "
                  f"Стран: {active_countries}")
            print(f"        CPU avg/max: {res['cpu_avg']}/{res['cpu_max']}%  "
                  f"RAM avg/max: {res['ram_avg']}/{res['ram_max']} МБ  "
                  f"(парсинг {parse_sec}с)")
        else:
            print(f"        Первое сохранение. Дата: {game_date}")
            print(f"        Дивизий: {divisions} (армий: {army_groups})  "
                  f"Кораблей: {ships}  Самолётов: {planes}  "
                  f"Стран: {active_countries}")

        self.records.append(record)
        save_data(self.records)
        self.last_processed_signature = final_sig or (final_size, int(write_end * 1_000_000_000))
        print(f"        → {OUTPUT_JSON}\n")


def main():
    if not os.path.isdir(SAVE_DIR):
        print(f"ОШИБКА: папка не найдена:\n  {SAVE_DIR}")
        return

    print("HOI4 Autosave Tracker v6")
    print(f"  Папка:  {SAVE_DIR}")
    print(f"  Файл:   {TARGET_FILENAME}")
    print(f"  Вывод:  {OUTPUT_JSON}")
    print(f"  Мониторинг ресурсов каждые {RESOURCE_POLL_MS} мс во время записи файла")
    print("  Ctrl+C для остановки.\n")

    handler  = AutosaveHandler()
    observer = Observer()
    observer.schedule(handler, SAVE_DIR, recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nОстановка...")
        observer.stop()
    observer.join()
    print("Завершено.")


if __name__ == "__main__":
    main()