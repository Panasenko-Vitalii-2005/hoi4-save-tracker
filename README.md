# HOI4 Save Tracker

Интерактивный анализатор автосейвов Hearts of Iron IV с веб-интерфейсом, анализом стран и военной инфраструктуры.

## Что это

Проект объединяет:

- `server/` — NestJS backend, анализатор HOI4-сейвов и API для фронтенда.
- `client/` — Vite + React SPA, отображает дашборд, сохранения и аналитику страны.
- `data/` — исторические телеметрические данные автосейвов.
- `saves/` — каталог примеров `.hoi4` файлов.
- Корневые Python-скрипты для старых диагностик и утилит.

## Плюсы

- Веб-интерфейс с браузером сохранений, графиками и таблицами.
- Парсер HOI4-сейвов со статистикой по странам и военной индустрии.
- Поддержка zip/сжатых `.hoi4` файлов.
- Отдельные API для анализа, списка сохранений, телеметрии и состояния сервера.

## Структура

```
server/       # NestJS backend
client/       # Vite + React frontend
data/         # JSON с автосейв-телеметрией
saves/        # тестовые save-файлы
*.py          # Python-утилиты и диагностические скрипты
```

## Требования

- Node.js 18+ / 20+
- npm
- Для Python-утилит: Python 3.11+ (опционально)

## Установка

### Сервер

```bash
cd server
npm install
```

### Клиент

```bash
cd client
npm install
```

## Запуск в режиме разработки

### Фронтенд

```bash
cd client
npm run dev
```

### Бэкенд

```bash
cd server
npm run start:dev
```

> При таком запуске клиент работает отдельно от бэкенда. В продакшен-сборке фронтенд компилируется в `client/dist`, и NestJS обслуживает статические файлы.

## Продакшен-сборка

```bash
cd client
npm run build
cd ../server
npm run build
npm run start:prod
```

## Основные API

- `GET /api/saves` — список доступных `.hoi4` файлов в директории HOI4.
- `POST /api/analyze` — анализ конкретного файла.
- `GET /api/records` — телеметрические записи автосейвов.
- `GET /api/soldiers` — историческая статистика войск по странам.
- `GET /api/health` — проверка здоровья сервера.

## Как работает анализатор

Ядро анализа находится в `server/src/hoi4/hoi4-parser.ts`.

- Парсит данные `countries={}` и `states={}`.
- Собирает статистику по:
  - бойцам в полях (`army_manpower_value`)
  - кораблям и авиации
  - государственным фабрикам, гражданским фабрикам и докам
- Возвращает структурированный JSON в формате `AnalyzeResult`.

## Использование UI

1. Откройте вкладку `Analyzer`.
2. Нажмите на save-файл из списка.
3. Дождитесь анализа.
4. Просмотрите графики мощности, флота, авиации и индустрии.

## Конфигурация путей

`server/src/saves/saves.controller.ts` автоматически ищет HOI4-сейвы в стандартных директориях Windows:

- `~/OneDrive/Документы/Paradox Interactive/Hearts of Iron IV/save games`
- `~/OneDrive/Documents/Paradox Interactive/Hearts of Iron IV/save games`
- `~/Документы/Paradox Interactive/Hearts of Iron IV/save games`
- `~/Documents/Paradox Interactive/Hearts of Iron IV/save games`

Если требуемая папка не найдена, UI позволяет ввести директорию вручную.

## Дополнительно

- `client/src/types/index.ts` содержит типы для фронтенда.
- `server/src/records/records.controller.ts` обслуживает данные из `data/autosave_intervals.json`.
- `server/src/app.module.ts` настраивает статическое обслуживание `client/dist`.

## Рекомендации для развития

- Вынести общие типы `CountryStats`/`AnalyzeResult` в shared-пакет.
- Перевести backend на асинхронное файловое API (`fs/promises`).
- Добавить валидацию DTO для запроса `/api/analyze`.

## Лицензия

Проект не содержит явно указанной лицензии. Можно добавить `LICENSE` по необходимости.
