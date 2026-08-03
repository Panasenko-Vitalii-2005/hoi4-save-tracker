"""
HOI4 Autosave Watcher (v2, content-hash based)
------------------------------------------------
Следит за файлом autosave_temp.hoi4 в папке сохранений HOI4.
Копирует его в save-tracker/saves ТОЛЬКО когда содержимое файла
реально изменилось (т.е. игра переписала сейв), а не при любом
"касании" файла (например, синхронизацией OneDrive).

Копия получает индекс: autosave_1_temp.hoi4, autosave_2_temp.hoi4, ...

Запуск:
    python hoi4_autosave_watcher.py

Зависимостей вне стандартной библиотеки нет.
"""

import time
import shutil
import re
import json
import hashlib
from pathlib import Path

# --- Пути ---
SOURCE_FILE = Path(
    r"C:\Users\panas\OneDrive\Документы\Paradox Interactive\Hearts of Iron IV\save games"
    r"\autosave_temp.hoi4"
)
DEST_DIR = Path(r"D:\custom-projects\save-tracker\saves")
STATE_FILE = DEST_DIR / ".watcher_state.json"

# --- Настройки ---
POLL_INTERVAL = 3.0          # сек между проверками mtime/size файла
STABLE_CHECK_INTERVAL = 1.0  # сек между проверками размера при ожидании стабильности
STABLE_CHECK_COUNT = 3        # сколько раз подряд размер не должен меняться
STABLE_MAX_ATTEMPTS = 120     # ~2 минуты максимум ожидания стабилизации


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"last_hash": None, "last_mtime": None, "last_size": None}


def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def wait_until_stable(path: Path) -> bool:
    """Ждёт, пока размер файла перестанет меняться (игра закончила запись)."""
    last_size = -1
    stable_count = 0
    attempts = 0

    while stable_count < STABLE_CHECK_COUNT and attempts < STABLE_MAX_ATTEMPTS:
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            time.sleep(STABLE_CHECK_INTERVAL)
            attempts += 1
            continue

        if size == last_size and size > 0:
            stable_count += 1
        else:
            stable_count = 0
            last_size = size

        time.sleep(STABLE_CHECK_INTERVAL)
        attempts += 1

    return stable_count >= STABLE_CHECK_COUNT


def get_next_index() -> int:
    pattern = re.compile(r"^autosave_(\d+)_temp\.hoi4$")
    max_index = 0
    for f in DEST_DIR.glob("autosave_*_temp.hoi4"):
        m = pattern.match(f.name)
        if m:
            max_index = max(max_index, int(m.group(1)))
    return max_index + 1


def main():
    DEST_DIR.mkdir(parents=True, exist_ok=True)

    if not SOURCE_FILE.parent.exists():
        print(f"Ошибка: директория не найдена: {SOURCE_FILE.parent}")
        return

    state = load_state()
    print(f"Слежу за файлом: {SOURCE_FILE}")
    print(f"Копирую в: {DEST_DIR}")
    if state["last_hash"]:
        print("Найдено сохранённое состояние — дубли скопированного сейва создаваться не будут.")
    print("Нажмите Ctrl+C для остановки.\n")

    while True:
        try:
            if not SOURCE_FILE.exists():
                time.sleep(POLL_INTERVAL)
                continue

            stat = SOURCE_FILE.stat()
            current_mtime = stat.st_mtime
            current_size = stat.st_size

            # Дешёвая проверка: если mtime и size не поменялись — точно ничего не делать
            if (
                current_mtime == state.get("last_mtime")
                and current_size == state.get("last_size")
            ):
                time.sleep(POLL_INTERVAL)
                continue

            ts = time.strftime("%H:%M:%S")
            print(f"[{ts}] Файл изменился (mtime/size), проверяю...")

            if not wait_until_stable(SOURCE_FILE):
                print(f"[{ts}] Файл не стабилизировался, пропуск проверки.")
                time.sleep(POLL_INTERVAL)
                continue

            # Пересчитываем актуальные mtime/size после стабилизации
            stat = SOURCE_FILE.stat()
            current_mtime = stat.st_mtime
            current_size = stat.st_size

            new_hash = file_hash(SOURCE_FILE)

            if new_hash == state.get("last_hash"):
                # Содержимое не поменялось (например, это было касание файла OneDrive) —
                # запоминаем новые mtime/size, чтобы больше не пересчитывать хэш зря,
                # но копию НЕ делаем.
                state["last_mtime"] = current_mtime
                state["last_size"] = current_size
                save_state(state)
                print(f"[{time.strftime('%H:%M:%S')}] Содержимое не изменилось, копия не создаётся.")
                time.sleep(POLL_INTERVAL)
                continue

            # Содержимое реально новое — копируем
            index = get_next_index()
            dest_name = f"autosave_{index}_temp.hoi4"
            dest_path = DEST_DIR / dest_name

            shutil.copy2(SOURCE_FILE, dest_path)

            state["last_hash"] = new_hash
            state["last_mtime"] = current_mtime
            state["last_size"] = current_size
            save_state(state)

            print(f"[{time.strftime('%H:%M:%S')}] Новый сейв обнаружен -> скопирован как {dest_name}")

        except KeyboardInterrupt:
            print("\nОстановлено.")
            break
        except Exception as e:
            print(f"Ошибка: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()




    