# HOI4 Save Tracker

HOI4 Save Tracker is a local analytics platform for **Hearts of Iron IV** save files, campaign progression, save comparison, and autosave performance telemetry. It turns large `.hoi4` saves into explorable military, industrial, logistics, and campaign-level snapshots while keeping the workflow local.

## Key features

### Save intelligence

- Analyze plain or compressed HOI4 saves through a responsive React interface.
- Review country-level divisions, manpower in the field, aircraft, ships, and effective industry.
- Inspect land forces, command hierarchies, division templates, current equipment, national stockpiles, and active land/air production lines.
- Explore calculated war casualties by country, opponent, and bilateral war record.
- Recover naval-loss events and safely credited naval kills from the data retained by a save.

### Campaign workflows

- Keep a durable **Recent Analyses** history and reopen results without the original save or another parser run.
- Compare two persisted snapshots using explicit **Target − Base** semantics and campaign, chronology, and game-version context.
- Build **Campaign Trends** from persisted analyses, with global or country metrics, presets, normalization, moving averages, and a save timeline.
- Create revocable, read-only public share links for persisted analyses.
- Import many saves with **Batch Analysis**; content hashes identify known results so only new saves are analyzed.

### Engineering and operations

- Run CPU-intensive parsing in bounded Node.js Worker Threads so the API event loop remains responsive.
- Protect uploads with size, timeout, archive-layout, decompression, and temporary-file cleanup controls.
- Deduplicate saves by raw-file SHA-256, share in-flight work, cache recent results in memory, and persist completed results locally.
- Collect optional autosave write-time, CPU, RAM, and campaign telemetry with the independent Python tracker.
- Protect parser behavior with focused unit, integration, upload, persistence, comparison, and regression tests.

## Screenshots

Project screenshots are not currently tracked in the repository. Useful additions would cover the Save Analyzer, Compare Saves, Campaign Trends, Recent Analyses, and Batch Analysis views.

## Architecture

### Save analysis

```text
.hoi4 upload or local save
        ↓
upload validation and resource limits
        ↓
SHA-256 identity and deduplication
        ↓
bounded Node.js Worker Thread
        ↓
HOI4 parser and deterministic aggregation
        ↓
AnalyzeResult
        ↓
in-memory cache + durable filesystem persistence
        ↓
Recent Analyses / Compare / Trends / Share Links
        ↓
React UI
```

The backend stores recent-analysis metadata and gzip-compressed analysis results on the local filesystem. Docker uses a named volume for this data. It does not require a database, Redis, or an external queue.

### Batch analysis

```text
multiple selected saves
        ↓
sequential browser SHA-256 preflight
        ↓
known hashes reused + new saves queued
        ↓
existing hardened analysis pipeline
        ↓
each successful result persisted immediately
        ↓
campaign grouping by game_unique_id
        ↓
Campaign Trends
```

Batch import is browser-orchestrated and processes new files independently. A failure does not discard successful results, and reselecting the same collection naturally resumes through hash recognition.

### Autosave telemetry

The optional Python tracker watches the HOI4 autosave, measures file-write duration and process CPU/RAM, extracts lightweight save statistics, and writes `data/autosave_intervals.json`. The NestJS telemetry endpoints and React telemetry panel read that file.

Autosave telemetry is independent of Campaign Trends. Trends are built from persisted full save analyses, not from tracker records.

## Core product workflows

### Analyze a save

Upload one `.hoi4` file, or select one from the configured local save directory, then inspect its overview and detailed War Casualties, Naval Losses, Stockpile, Production, and Land Forces views.

### Build campaign history

Select or drop multiple saves in Batch Analysis. The browser identifies duplicate content, the backend reuses persisted hashes, and only new saves enter the bounded analysis pipeline. Persisted snapshots with the same `game_unique_id` become one campaign timeline.

### Compare saves

Choose two persisted analyses as Base and Target. Every delta is calculated as:

```text
Delta = Target − Base
```

The UI identifies reverse chronology, identical analyses, same-date snapshots, known campaign mismatch, and known game-version mismatch. Added and removed countries represent snapshot presence, not inferred creation or annexation events. Casualty and naval-loss deltas compare cumulative snapshot values; they do not prove that every difference occurred during the selected interval.

### Share an analysis

Create a read-only public link from a persisted Recent Analysis and revoke it when it is no longer needed. The link exposes the intended shared analysis route, not the original `.hoi4` file.

## Project components

- **`client/`** — React 19, TypeScript, Vite, Plotly, responsive analyzer views, comparisons, trends, recent-history management, sharing, and batch orchestration.
- **`server/`** — NestJS API, save validation, Worker orchestration, parser modules, deterministic aggregators, filesystem persistence, comparison/trend DTOs, and share-link APIs.
- **Python utilities** — `tracker.py` records detailed autosave telemetry; `hoi4_autosave_watcher.py` creates content-hash-aware indexed save copies; `dashboard.py` serves the legacy telemetry dashboard in `web/`.
- **`diagnostics/`** — focused Python tools for validating unit, manpower, equipment, division, and industry interpretations against real saves.
- **`server/scripts/`** — developer investigation scripts for war-casualty parsing and duplicate/mirror analysis.

## Technology stack

| Area | Technologies |
| --- | --- |
| Frontend | React, TypeScript, Vite, Plotly, Vitest, oxlint |
| Backend | Node.js, NestJS, TypeScript, Worker Threads, Jest |
| Parsing and storage | Custom HOI4 text/ZIP parser, SHA-256, gzip-compressed filesystem persistence |
| Telemetry | Python, watchdog, psutil |
| Deployment | Docker Compose, nginx |

## Local development

There is no root Node package; install and run the backend and frontend separately.

### Backend

```bash
cd server
npm ci
npm run start:dev
```

The NestJS API listens on `http://localhost:3001` by default.

### Frontend

In another terminal:

```bash
cd client
npm ci
npm run dev
```

Vite serves the application at `http://localhost:5173` and proxies `/api` requests to the local backend.

### Optional Python autosave tools

The Python utilities currently keep local Windows save paths as constants near the top of their files. Update those paths before running them on another machine.

The lightweight content-hash watcher uses only the Python standard library:

```bash
python hoi4_autosave_watcher.py
```

The telemetry tracker additionally requires `watchdog` and `psutil`:

```bash
python -m pip install watchdog psutil
python tracker.py
```

To view its legacy standalone web dashboard after telemetry data exists:

```bash
python dashboard.py
```

It serves `web/` at `http://127.0.0.1:8765`.

## Docker

Start the production-like two-container application from the repository root:

```bash
docker compose up --build
```

Open [http://localhost:8081](http://localhost:8081).

- nginx serves the built React SPA and proxies `/api/*` to the internal NestJS service.
- Browser uploads use temporary container storage and are removed after processing, including supported failure paths.
- Save files are excluded from both images.
- `./saves` is mounted read-only at `/app/saves` for optional local browsing; browser upload works independently of that mount.
- Recent metadata, compressed results, and share-link metadata persist in the `analysis-history` named volume.
- A Windows path entered in the browser cannot dynamically create a Docker mount. Change or override the Compose volume mapping instead.
- Large late-game or modded saves can require substantial container memory while decoded and analyzed.

Stop the application with:

```bash
docker compose down
```

Removing the named volume with `docker compose down -v` also removes locally persisted analysis history, results, and share links.

## Batch Analysis

1. Select or drop multiple `.hoi4` files.
2. The browser computes SHA-256 hashes sequentially and asks the backend which results already exist.
3. Duplicate selections and already persisted saves are skipped.
4. New files use the same upload validation, Worker limits, cache, and cleanup path as single-save analysis.
5. Every successful result is persisted immediately.
6. A failed file does not abort the remaining batch.
7. Selecting the collection again resumes naturally because known hashes are reused.
8. Persisted snapshots become available to Recent Analyses, Compare Saves, and Campaign Trends.

## Campaign Trends

- Trend snapshots come from durable analysis results.
- `game_unique_id` is used as campaign identity when available; saves known to belong to different campaigns are not silently combined.
- Legacy results without campaign identity remain unknown and isolated instead of being merged together.
- Global and per-country metrics support presets, optional 0–1 normalization, moving averages over ordered snapshots, and an exact save timeline.
- Values are discrete analyzed-save snapshots, not continuous gameplay telemetry.
- Missing country or metric values remain unavailable gaps and are never fabricated as zero.

## Compare Saves

- Deltas always use **Target − Base**, including when Target is chronologically earlier.
- The comparison reports same-analysis, same-date, reverse-chronology, campaign-compatibility, and game-version context when metadata is available.
- Countries found in only one snapshot are marked Added or Removed; missing values are not converted to zero.
- Casualty and recorded naval-loss differences remain snapshot comparisons, not asserted interval events.

## Data and privacy

- `.hoi4` files and `saves/` are excluded from Git and the Docker build context. Saves can be large and contain local campaign data; users provide their own files.
- Uploaded raw saves are temporary and are removed after analysis. They are not retained as Recent Analysis data.
- Recent metadata, compressed `AnalyzeResult` files, and share metadata are stored locally in `server/data/` by default, or in the Docker named volume under Compose.
- Public share links are opt-in and read-only, but the current application has no user accounts or per-user ownership. Treat its local storage and deployment as shared application data.
- Filenames, campaign identifiers, and parsed campaign statistics are still user data. Keep the storage directory and any generated share links appropriately private.

## Tests and verification

### Backend

```bash
cd server
npm test
npm run build
```

Additional backend scripts include `npm run test:watch`, `npm run test:cov`, and `npm run test:e2e`.

### Frontend

```bash
cd client
npm test
npm run lint
npm run build
```

The suites cover parser and aggregation semantics, upload boundaries, Worker behavior, caching and persistence, Recent Analyses, Compare, Campaign Trends, Share Links, Batch Analysis, and frontend interaction regressions.

## Current limitations

- The parser depends on HOI4's semi-structured save format. Game updates and mods can introduce fields or structures that require new fixtures and parser adjustments.
- Exact historical equipment losses are not generally recoverable from one save; current equipment, stockpile, and production snapshots should not be interpreted as a complete loss history.
- Calculated war casualties are sums of bilateral `war_relation` entries. They preserve the save's snapshot semantics rather than claiming a complete event ledger.
- Recoverable naval events depend on the historical records retained in the save, and credited killer information is not available for every loss.
- Campaign Trends include only saves that have been analyzed and successfully persisted. They are not continuous history.
- Older persisted analyses may lack campaign identity or other newer context fields; unknown values remain explicit.
- Browser Batch Analysis requires the user to select files; a browser cannot enumerate an arbitrary local directory automatically.
- Persistence, admission limits, and caches are process-local filesystem/in-memory mechanisms, not multi-user or multi-instance cloud infrastructure.
- Public hosting currently has no authentication or per-user data ownership. Production exposure would need TLS, external rate/connection limits, and deployment-level memory/disk controls.
- Several diagnostic scripts are developer-oriented and encode assumptions for targeted save investigations.

## Possible next steps

- Add authentication and per-user ownership before multi-user public hosting.
- Support shared persistence and distributed admission if multi-instance deployment becomes necessary.
- Expand compatibility fixtures for new HOI4 versions and representative mods.
- Externalize Python watcher configuration and consolidate the legacy telemetry utilities.
- Add exportable reports and tracked product screenshots.
- Investigate additional air or equipment loss history only where save evidence supports reliable semantics.

## Repository structure

```text
save-tracker/
├── client/                     # React/Vite application
│   ├── src/components/analyzer # Save analysis, Recent, Compare, Batch
│   ├── src/components/chart    # Campaign Trends and telemetry charts
│   └── tests/                  # Frontend interaction tests
├── server/
│   ├── src/analyze/            # Analysis, history, comparison, trends, shares
│   ├── src/hoi4/               # Parser, workers, domain parsers, aggregators
│   ├── src/saves/              # Safe local-save browsing
│   ├── scripts/                # Developer parser investigations
│   └── test/                   # Backend end-to-end tests
├── diagnostics/                # Standalone parser validation utilities
├── web/                        # Legacy Python telemetry dashboard assets
├── tracker.py                  # Autosave performance telemetry
├── hoi4_autosave_watcher.py    # Content-aware autosave copier
├── dashboard.py                # Standalone telemetry web server
├── docker-compose.yml
└── README.md
```

Local saves, generated telemetry, persisted results, dependencies, coverage, and build output are intentionally omitted from this tree.

## Engineering highlights

This repository demonstrates engineering around a large semi-structured save format: scoped parsing and deterministic aggregation, frontend/backend contract synchronization, normalized public payloads, Worker Thread isolation, bounded uploads and decompression, filesystem persistence, SHA-256 deduplication, resumable browser batch orchestration, campaign identity and compatibility rules, compact comparison/trend DTOs, responsive data-heavy UI, and regression-focused testing.
