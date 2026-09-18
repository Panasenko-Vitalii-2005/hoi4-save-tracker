# HOI4 Save Tracker

HOI4 Save Tracker is a local-first analytics application for **Hearts of Iron IV** save files. It parses large plain-text or ZIP-compressed `.hoi4` saves, persists compact derived results, and turns a sequence of snapshots into explorable country statistics, comparisons, campaign trends, exports, and printable reports.

The project is designed around explicit snapshot semantics: it shows what the save contains, preserves unavailable values as unavailable, and avoids presenting inferred history as fact.

## What it does

- Analyzes one save and exposes country, industry, land-force, stockpile, production, casualty, and naval-loss detail.
- Imports a collection of saves as a bounded campaign workflow, reusing already known content hashes.
- Reopens recent analyses from gzip-compressed local persistence without the original save or another parser run.
- Compares two snapshots with explicit **Target − Base** deltas and compatibility context.
- Builds campaign trends from every persisted snapshot in an exact `game_unique_id` group.
- Manages local analysis storage, pins, campaign cleanup, and opt-in read-only share links.
- Exports deterministic CSV/JSON data and renders human-readable single-save, comparison, and campaign reports for browser printing.

## Screenshots

| Recent Analyses and storage | Compare Saves |
| --- | --- |
| ![Recent Analyses with local storage summary](docs/assets/recent-analyses.png) | ![Save comparison with country deltas](docs/assets/compare-saves.png) |

| Campaign Trends | Analysis report |
| --- | --- |
| ![Campaign Trends across persisted snapshots](docs/assets/campaign-trends.png) | ![Human-readable save analysis report](docs/assets/analysis-report.png) |

The screenshots use real parsed campaign data from a local read-only copy of the persistence store. Original `.hoi4` files are not included in the repository.

## Core features

### Single-save analysis

The analyzer presents strategic totals and per-country data, plus focused views for:

- effective civilian, military, and dockyard industry;
- bilateral war-casualty records;
- recoverable naval-loss events and conservatively credited kills;
- national stockpiles and exact equipment designs;
- current land/air military production lines, rates, efficiency, and shortages;
- divisions, templates, equipment, manpower components, and army hierarchy.

### Campaign workflow

**Import Campaign** accepts multiple selected saves. The browser hashes files sequentially, asks the API which results already exist, and submits only unknown content through the same hardened upload pipeline. Each successful analysis is durable immediately; one failed save does not discard the others.

**Recent Analyses** provides reopen, pin, delete, share, compare, report, export, and local-storage management actions. Bulk cleanup protects pinned analyses by default.

**Campaign Trends** plots all persisted snapshots in chronological order. Global and per-country scopes support presets, optional normalization, moving averages, readable date ticks, hover detail, and an exact save timeline.

### Compare, export, and reports

- Compare uses the union of exact country tags and reports added, removed, changed, and unavailable values.
- CSV and JSON exports are generated from the same loaded DTOs used by the UI; no second analysis is run.
- Single Save, Compare, and Campaign reports share a document-oriented report shell.
- Print uses the browser print dialog rather than a server-side PDF engine.

### Upload and runtime hardening

- admission control begins before multipart parsing;
- raw upload, uncompressed payload, ZIP directory, and ZIP entry limits;
- validation for plain and compressed HOI4 containers;
- upload and Worker deadlines;
- bounded Worker concurrency and V8 heap limits;
- cleanup for success, validation errors, crashes, timeouts, and interrupted uploads;
- safe public error messages without stack traces or local paths.

## Architecture

```mermaid
flowchart LR
  UI[React / Vite browser UI] --> API[NestJS API]
  API --> Gate[Upload admission and validation]
  Gate --> Hash[SHA-256 cache and in-flight deduplication]
  Hash --> Worker[Bounded Worker Thread]
  Worker --> Parser[HOI4 parser and aggregators]
  Parser --> Result[AnalyzeResult]
  Result --> Cache[In-memory LRU cache]
  Result --> Store[Gzip result persistence]
  Store --> Recent[Recent metadata]
  Store --> Views[Compare / Trends / Reports / Export]
  Store --> Share[Opt-in public share link]
  API --> Auth[Auth endpoints and opaque sessions]
  Auth --> Postgres[(PostgreSQL users and sessions)]
```

The browser owns presentation and batch orchestration. NestJS owns admission, validation, caching, persistence, and compact downstream DTOs. CPU-heavy decoding/parsing runs in a Worker Thread so the HTTP event loop stays responsive. The parser remains a deterministic backend boundary; the frontend never parses save text.

See [Architecture](docs/architecture.md) for component boundaries, persistence details, API routes, and failure behavior.

## Analysis pipeline

1. A multipart upload or validated local-save path enters the analyzer.
2. Request admission and size/time limits are applied; uploaded bytes go to a managed temporary file.
3. The container is validated as supported HOI4 plain text or ZIP, including actual decompressed-byte limits.
4. SHA-256 of the original save bytes becomes the analysis identity.
5. A completed in-memory result or matching in-flight request is reused when available.
6. Otherwise a bounded Worker decodes the save once, builds shared structural indexes, parses it, and returns `AnalyzeResult` plus campaign context.
7. The result is gzip-compressed and atomically persisted; compact Recent metadata is updated separately.
8. Compare, Trends, Reports, Export, Storage, and Share read persisted results without rerunning the parser.
9. Managed temporary uploads are removed on success and supported failure/abort paths.

## Campaign and data semantics

- Exact `game_unique_id` is authoritative for campaign grouping and comparison compatibility. Filenames, dates, and country names are never used to guess campaign identity.
- Legacy results without campaign identity remain unknown and isolated.
- Compare delta is always **Target − Base**; selecting an earlier Target does not reorder the inputs.
- Compare is a comparison of two saved snapshots, not a reconstruction of every event between them.
- War casualties are calculated from bilateral `war_relation` records retained in the save.
- Naval losses reflect recoverable historical records; killer attribution is intentionally conservative and is unavailable for some events.
- Missing numeric values remain `null`/unavailable rather than becoming zero.
- Trend normalization and moving averages affect chart presentation only. Exports and report summaries retain raw snapshot values.

## Demonstration path

1. Open **Save Analyzer** and analyze one `.hoi4` save.
2. Use **Import Campaign** to select a sequence of saves.
3. Reopen and manage snapshots in **Recent Analyses**.
4. Choose Base and Target in **Compare Saves**.
5. Explore the exact campaign in **Campaign Trends**.
6. Open **View Report**, print it, or export CSV/JSON.

## Performance and scale

Measurements below are engineering checkpoints from the same Windows development machine and the repository's approximately 104 MB control save; they are not cross-machine guarantees.

- The direct parser path was reduced historically from roughly **29–30 s** to roughly **3.3–3.4 s** through structural-index reuse and targeted scan elimination (about an 8× improvement).
- At the Worker checkpoint, direct analysis measured about **3.327 s median** and Worker-backed analysis about **3.472 s median** (roughly 4.3% process-boundary overhead).
- During analysis, median health-request latency improved from roughly **1.7 s** on the main thread to about **1.25 ms** with the Worker boundary.
- The real campaign used for UI validation contains **179 persisted snapshots** spanning `1936.2.1` to `1950.11.1`.
- Persisted results are gzip-compressed. A representative control result measured about **6.55 MiB JSON** and **481 KiB gzip** at the persistence checkpoint.
- Storage status uses filesystem metadata for compressed artifacts; it does not inflate results, run the parser, or start a Worker.

These values were recorded during specific optimization checkpoints. Hardware, Node version, save compression, mods, and campaign size affect runtime and memory.

## Correctness checkpoint

`autosave_100_temp.hoi4` is used locally as a regression fixture for end-to-end diagnostics (the file itself is ignored by Git):

| Metric | Verified value |
| --- | ---: |
| Game date | `1944.5.1` |
| Active countries | 96 |
| Divisions | 3,250 |
| Aircraft | 53,095 |
| Ships | 1,539 |
| Naval losses | 993 |

Representative Germany industry totals:

| Military factories | Civilian factories | Dockyards |
| ---: | ---: | ---: |
| 286 | 228 | 39 |

These are regression checkpoints for one save, not universal expectations for HOI4 campaigns.

## Tech stack

| Area | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Plotly, Vitest, oxlint |
| Backend | Node.js 22, NestJS 11, TypeScript, Worker Threads, Jest |
| Parsing | Custom HOI4 text/ZIP decoder, structural indexes, deterministic aggregators |
| Persistence | SHA-256 identity, gzip, atomic filesystem writes |
| Deployment | Docker Compose, nginx, optional Caddy private-alpha edge |
| Optional telemetry | Python, watchdog, psutil |

## Running locally

### Docker Compose (recommended)

Requirements: Docker Desktop with Compose v2.

```bash
docker compose up --build
```

Open [http://localhost:8081](http://localhost:8081). Stop with `docker compose down`.

- `./saves` is mounted read-only at `/app/saves`, but local browsing and path analysis are disabled by default. Set `HOI4_LOCAL_SAVES_ENABLED=true` explicitly for trusted local use; browser upload works independently.
- `analysis-history` is a named volume containing Recent metadata, compressed results, and share metadata.
- `postgres-data` stores future SaaS metadata. Compose runs the versioned migrations before starting the backend; PostgreSQL is not published to the host network.
- Save files are excluded from both Docker images.
- `docker compose down -v` also deletes both named persistence volumes; use it only when that is intended.

Set both `FRONTEND_PORT` and the matching exact `HOI4_CORS_ORIGIN` when changing the host port, for example `FRONTEND_PORT=8090 HOI4_CORS_ORIGIN=http://localhost:8090 docker compose up --build` in a shell that supports inline environment variables.

For trusted local browsing/path analysis, opt in explicitly with `HOI4_LOCAL_SAVES_ENABLED=true docker compose up --build`. Do not enable this mode on a public deployment.

### Private Alpha deployment

For 2–5 trusted users on one Internet-facing VPS, use the dedicated [Private Alpha deployment profile](docs/private-alpha.md). It adds Caddy-managed HTTPS and a deployment-level Basic Auth gate while keeping the normal application authentication active. The profile requires operator-supplied secrets, removes the host `./saves` mount, keeps PostgreSQL/backend private, and preserves the PostgreSQL and analysis-history volumes.

This profile is **not** a public closed-beta configuration. It includes separate operator-installed PostgreSQL and `analysis-history` backup timers plus append-only off-site replication, but atomic cross-store snapshots, an off-site retention policy, per-user quotas, abuse controls, application registration gating, and stronger readiness/alerting remain outstanding.

### Native development

Requirements: Node.js 22 and npm.

```bash
cd server
npm ci
npm run start:dev
```

In another terminal:

```bash
cd client
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to `http://localhost:3001`.

By default native persistence is relative to `server/` under `server/data/`. The local-save browser and server-path analysis are unavailable unless `HOI4_LOCAL_SAVES_ENABLED=true`; `HOI4_SAVES_DIR` then controls the exposed directory.

## Configuration

All values are optional; invalid numeric values fall back to the documented defaults unless noted.

| Group | Variable | Default | Purpose |
| --- | --- | ---: | --- |
| Server | `PORT` | `3001` | NestJS listen port |
| Server | `HOI4_CORS_ORIGIN` | `http://localhost:5173` natively; `http://localhost:8081` in Compose | Exact credentialed frontend HTTP(S) origin; wildcard origins are rejected |
| Database | `HOI4_DATABASE_ENABLED` | `false` native; `true` in Compose | Enable PostgreSQL connectivity validation; only exact `true` enables it |
| Database | `DATABASE_URL` | none native; development-only Compose URL | PostgreSQL connection string; required when database mode is enabled |
| Database | `POSTGRES_DB` | `hoi4_tracker` in Compose | Compose development database name |
| Database | `POSTGRES_USER` | `hoi4_tracker` in Compose | Compose development database user |
| Database | `POSTGRES_PASSWORD` | development-only value in Compose | Compose development password; override outside local development |
| Auth | `HOI4_SESSION_TTL_SECONDS` | `604800` (7 days) | Fixed session lifetime; accepted range is 300 seconds through 365 days, otherwise startup fails |
| Auth | `HOI4_SESSION_COOKIE_SECURE` | production mode; `false` in local HTTP Compose | Require HTTPS transport for the auth cookie; only exact `true`/`false` is accepted |
| Local saves | `HOI4_LOCAL_SAVES_ENABLED` | `false` | Enable trusted server-side save browsing and path analysis only when exactly `true` |
| Local saves | `HOI4_SAVES_DIR` | `../saves` from backend cwd | Read-only local-save browser root |
| Upload | `HOI4_UPLOAD_DIRECTORY` | OS temp directory | Managed temporary uploads |
| Upload | `HOI4_MAX_UPLOAD_BYTES` | 256 MiB | Raw uploaded-file limit |
| Upload | `HOI4_MAX_UNCOMPRESSED_BYTES` | 512 MiB | Plain/decompressed content limit |
| Upload | `HOI4_UPLOAD_TIMEOUT_MS` | 120,000 | Multipart receive deadline |
| Admission | `HOI4_ANALYSIS_REQUESTS` | `2` | Concurrent admitted analysis requests per process |
| Worker | `HOI4_ANALYSIS_WORKERS` | `1` | Active analysis Workers per process; invalid values fail startup |
| Worker | `HOI4_ANALYSIS_TIMEOUT_MS` | 60,000 | Hard analysis deadline |
| Worker | `HOI4_ANALYSIS_HEAP_MB` | 1,024 | V8 old-generation limit per Worker |
| Cache | `HOI4_ANALYSIS_CACHE_ENTRIES` | `3` | Completed in-memory results |
| Cache | `HOI4_TRENDS_CACHE_SNAPSHOTS` | `2048` | Cached campaign-trend snapshot projections |
| Cache | `HOI4_TRENDS_CACHE_BYTES` | 64 MiB | Cached snapshot-projection byte budget |
| Recent | `HOI4_RECENT_ANALYSES_FILE` | `data/recent-analyses.json` | Recent metadata file |
| Recent | `HOI4_RECENT_ANALYSES_LIMIT` | `200` | Metadata retention count |
| Results | `HOI4_ANALYSIS_RESULTS_DIR` | `data/analysis-results` | Gzip result directory |
| Results | `HOI4_ANALYSIS_RESULTS_MAX_BYTES` | 128 MiB | Hard compressed-result budget |
| Shares | `HOI4_SHARED_ANALYSES_FILE` | `data/shared-analyses.json` | Share metadata file |
| Shares | `HOI4_SHARED_ANALYSES_LIMIT` | `1,000` | Active share-link limit |
| Compose | `FRONTEND_PORT` | `8081` | Host port for nginx |

Limits are per backend process. The result byte ceiling is authoritative: unpinned files are evicted oldest-first, pins and active shares receive stronger protection, and the hard ceiling can ultimately remove any result. Metadata may remain even when a result is no longer reopenable.

## Important API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Internal compatibility health/database status |
| `GET` | `/api/readiness` | Minimal external application readiness check |
| `GET` | `/api/auth/csrf` | Establish the readable double-submit CSRF cookie |
| `POST` | `/api/auth/register` | Create an account and opaque server session; requires PostgreSQL |
| `POST` | `/api/auth/login` | Authenticate credentials and create a session; requires PostgreSQL |
| `GET` | `/api/auth/me` | Resolve the current auth session cookie |
| `POST` | `/api/auth/logout` | Revoke the current session and clear its cookie |
| `GET` | `/api/saves` | List configured local `.hoi4` files when local mode is enabled |
| `POST` | `/api/analyze` | Analyze multipart upload, or a validated local path when local mode is enabled |
| `POST` | `/api/analyze/batch/preflight` | Return already persisted hashes for a bounded batch |
| `GET` | `/api/analyze/recent` | List Recent metadata |
| `GET` | `/api/analyze/recent/:hash/result` | Reopen a persisted result |
| `PATCH` | `/api/analyze/recent/:hash` | Pin or unpin metadata |
| `DELETE` | `/api/analyze/recent/:hash` | Delete one recent analysis |
| `GET` | `/api/analyze/compare?base=&target=` | Compare two persisted results |
| `GET` | `/api/analyze/trends` | Build compact campaign trend DTOs |
| `GET` | `/api/analyze/storage` | Read compressed-result storage status |
| `DELETE` | `/api/analyze/storage/unpinned` | Delete unpinned analyses |
| `DELETE` | `/api/analyze/storage/campaign/:campaignId` | Delete one exact campaign group |
| `POST` | `/api/analyze/recent/:hash/share` | Create/reuse a public link |
| `DELETE` | `/api/analyze/recent/:hash/share` | Revoke a public link |
| `GET` | `/api/share/:id` | Open a shared read-only analysis |

Application APIs are private by default through a global session guard. Health/readiness, CSRF bootstrap, registration, login, idempotent logout, and `GET /api/share/:id` are the explicit public exceptions. Public unsafe auth operations still require the double-submit CSRF token. Private analysis listing, reads, comparisons, trends, storage views, mutations, share management, and batch preflight enforce the authenticated user's PostgreSQL ownership relation.

Local filesystem APIs are safe-by-default: when `HOI4_LOCAL_SAVES_ENABLED` is unset or anything other than `true`, `/api/saves`, `/api/saves/default-dir`, `/saves/analyze`, and JSON `path` requests to `/api/analyze` return 404. Keep this disabled for public/SaaS deployments. Enabling it deliberately exposes server-side save discovery/path analysis and is intended only for a trusted local environment. Multipart upload analysis is unaffected.

### PostgreSQL identity and ownership foundation

PostgreSQL stores account identities, server-side sessions, and analysis ownership metadata. Passwords use Node's asynchronous `scrypt` with a unique 16-byte salt, a versioned parameter-bearing encoding (`N=32768`, `r=8`, `p=1`), and a 64-byte derived key. Session tokens contain 256 random bits; only their SHA-256 hashes are stored. Login verifies a fixed dummy scrypt hash when an email is absent to reduce the simplest account-enumeration timing difference.

Successful registration/login sets `hoi4_session` as `HttpOnly`, `SameSite=Lax`, `Path=/`, with matching `Max-Age`/`Expires`; it is `Secure` by default when `NODE_ENV=production`. `HOI4_SESSION_COOKIE_SECURE` is an explicit exact-boolean override: local HTTP Compose sets it to `false`, while an HTTPS deployment must use `true`. Sessions have fixed expiry controlled by `HOI4_SESSION_TTL_SECONDS`; there are no refresh tokens or sliding expiry. Passwords must be 12–128 characters, with no composition rule. Emails are trimmed and lowercased while PostgreSQL `CITEXT` remains the final case-insensitive uniqueness authority.

When database mode is disabled, credential operations and a well-formed session lookup fail safely with a generic `503`; a private request without a cookie remains `401`. Authentication is never bypassed. Health, CSRF bootstrap, idempotent stale-cookie logout, and public share reads remain available. AnalyzeResult payloads remain compressed files under `data/analysis-results`; Recent content metadata and Shares remain the existing JSON stores, while PostgreSQL ownership is authoritative for private access.

The global guard authenticates product APIs through the `hoi4_session` HttpOnly cookie, and unsafe methods require the independent readable `hoi4_csrf` cookie to match `X-CSRF-Token`. A successful analysis inserts the authenticated user/SHA-256 pair into `analysis_ownership`; repeated uploads by one user are idempotent and different users may own the same globally deduplicated artifact. Per-user pin, safe filename, and analysis time live on that relation. Legacy artifacts without a row remain unowned and invisible to private APIs—there is no automatic backfill. Public capability-link reads are the explicit ownership exception.

Native startup leaves database mode disabled unless `HOI4_DATABASE_ENABLED=true`. Disabled mode creates no connection. Enabled mode requires a valid `DATABASE_URL` and fails startup if connectivity validation fails; credentials and connection URLs are never returned by health diagnostics. `/api/health` preserves the compatibility response `database: disabled`, `ok`, or `unavailable`. `/api/readiness` is ready only when PostgreSQL answers the bounded read-only probe and returns only `status: ok` or `status: unavailable`.

Migrations are explicit and are not run by ordinary backend startup. From `server/`:

```bash
npm run db:migrate:dev
npm run db:migrate:status
```

`db:migrate:dev` builds the migration runner and applies checked-in SQL migrations. Compose uses a separate one-shot `migrate` service before backend startup. Run isolated integration tests against a database whose name ends in `_test`:

```bash
HOI4_TEST_DATABASE_URL=postgresql://user:password@localhost:5432/hoi4_tracker_test npm run test:db
```

A future SaaS backup must include both PostgreSQL account/session metadata and the separate analysis artifact/JSON storage; neither is a replacement for the other.

## Persistence model

The analysis store persists:

- gzip-compressed derived `AnalyzeResult` envelopes, keyed by save-content SHA-256;
- compact Recent metadata such as filename, dates, availability, pin, and campaign context;
- separate opaque share-ID-to-hash metadata.

Writes use managed temporary files, fsync, and atomic rename. Mutations are serialized within one process. Reconciliation handles recognized stale temporary/orphan artifacts and does not traverse arbitrary files or symbolic links.

The analysis-result store does **not** retain uploaded original `.hoi4` files. The optional `./saves:/app/saves:ro` Compose mount is a separate user-provided source directory.

PostgreSQL provides account, opaque-session, and analysis-ownership persistence. Ownership metadata does not duplicate results: analysis artifacts remain file-based and keyed globally by SHA-256. Recent content metadata and Shares also remain file-based and global, but private views are ownership-filtered. Logical owned bytes are distinct from shared physical artifact bytes. Public capability-link reads remain independent of ownership.

At least one PostgreSQL ownership row or a valid public share protects an artifact from automated reconciliation and byte-budget eviction. Recent metadata remains useful for UI ordering and unowned cleanup, but is not retention authority for owned data. Ownership or share-state lookup failures fail closed by preserving unknown artifacts; if protected files consume the configured budget, a new result is declined instead of displacing them. Zero-owner, unshared artifacts remain eligible for the existing bounded reconciliation, while eager or scheduled garbage collection is deferred. One backend should own a persistence directory because there is still no cross-process file-store lock.

## Testing

Backend:

```bash
cd server
npm test
npm run build
```

Frontend:

```bash
cd client
npm test
npm run lint
npm run build
```

The suites cover parser/aggregation semantics, encoding and ZIP handling, upload admission and cleanup, Worker races, cache/deduplication, persistence and legacy compatibility, storage cleanup, share links, Compare, Campaign Trends, Batch Analysis, exports, reports, and interactive UI behavior.

## Project structure

```text
save-tracker/
├── client/
│   ├── src/components/analyzer/   # Analyze, Recent, Compare, storage, domain views
│   ├── src/components/chart/      # Campaign Trends and telemetry charts
│   ├── src/components/reports/    # Single, Compare, Campaign reports
│   ├── src/lib/                   # Validation, country names, CSV/JSON export
│   └── tests/                     # Vitest UI/contract tests
├── server/
│   ├── src/analyze/               # API, persistence, Compare, Trends, Batch, shares
│   ├── src/hoi4/                  # Parser, Worker, indexes, domain parsers/aggregators
│   ├── src/saves/                 # Safe local-save browsing
│   └── scripts/                   # Focused reverse-engineering diagnostics
├── diagnostics/                   # Independent save/game-data investigation tools
├── docs/                          # Architecture and curated screenshots
├── web/                           # Legacy Python telemetry dashboard
├── tracker.py                     # Optional autosave performance telemetry
├── hoi4_autosave_watcher.py       # Optional content-aware autosave copier
└── docker-compose.yml
```

Generated builds, dependencies, local persistence, telemetry output, and `.hoi4` saves are ignored by Git.

## Security and deployment notes

Implemented safeguards include strict upload/container validation, byte and entry limits, decompression bounds based on actual output, request/Worker deadlines, bounded concurrency and heap, temporary-file cleanup, opaque share IDs, safe error responses, and a bounded result store.

Important remaining limitations:

- authentication, ownership recording, and per-user authorization are implemented; per-user quotas and administrative recovery are not;
- Recent content metadata and public-share metadata remain global file stores, while private API projections and mutations are ownership-scoped;
- possession of a share link grants access to the complete derived analysis;
- admission, caches, rate semantics, and mutation queues are process-local;
- filesystem persistence has no multi-process locking or distributed coordination;
- no application-level TLS or durable authorization audit log;
- nginx/reverse-proxy TLS, external connection/rate limits, container memory, and volume backup are deployment responsibilities.

The current identity and ownership boundary enforces private per-user analysis access and protects owned/shared artifacts from automated physical eviction. Public hosting still requires edge-security deployment, operational backups, monitoring, and per-user quotas.

## Known limitations

- HOI4 updates and mods can introduce unknown fields or structures; open-ended identifiers are preserved where possible, but new fixtures may be required.
- A single save cannot reconstruct all historical equipment losses or every naval attribution.
- Trends contain analyzed snapshots only and are not continuous gameplay telemetry.
- Legacy persisted entries can lack campaign/player metadata and remain explicitly unknown.
- Browser import requires explicit file selection; browsers cannot enumerate arbitrary local directories.
- Reports print through the browser; there is no native PDF renderer.
- Report and chart state is client-side and is not encoded as a permanent route/bookmark.
- The optional Python telemetry utilities retain developer-oriented configuration and a separate legacy dashboard.

## Roadmap

- Add a per-user quota model before larger multi-user deployment; eager/scheduled ownerless-artifact collection remains deferred.
- Expand compatibility fixtures for newer HOI4 versions and representative mods.
- Add shared persistence/admission only if multi-instance deployment becomes a real requirement.
- Externalize and consolidate the optional Python telemetry configuration.
