# HOI4 Save Tracker backend

NestJS API for hardened HOI4 save ingestion, Worker-backed parsing, filesystem persistence, comparisons, campaign trends, storage management, and share links.

For the product overview and verified checkpoints, see the [root README](../README.md). For service boundaries and request flows, see [Architecture](../docs/architecture.md).

## Run

Requires Node.js 22.

```bash
npm ci
npm run start:dev
```

The API listens on `http://localhost:3001` by default. Production build:

```bash
npm run build
npm run start:prod
```

`start:prod` expects the Nest build output at `dist/src/main.js`.

## Test

```bash
npm test
npm run build
```

Additional scripts: `npm run test:watch`, `npm run test:cov`, and `npm run test:e2e`.

The configured `npm run lint` script applies ESLint fixes. For a read-only check, use:

```bash
npx eslint "{src,apps,libs,test}/**/*.ts"
```

## Important configuration

| Variable | Default | Meaning |
| --- | ---: | --- |
| `PORT` | `3001` | Listen port |
| `HOI4_CORS_ORIGIN` | `http://localhost:5173` | Exact frontend HTTP(S) origin allowed by CORS |
| `HOI4_DATABASE_ENABLED` | `false` | Enable PostgreSQL validation only when exactly `true` |
| `DATABASE_URL` | none | PostgreSQL URL required when database mode is enabled |
| `HOI4_SESSION_TTL_SECONDS` | `604800` | Fixed auth-session lifetime; 300 seconds to 365 days |
| `HOI4_SESSION_COOKIE_SECURE` | production mode; `false` in local HTTP Compose | Exact boolean controlling HTTPS-only auth cookies |
| `HOI4_LOCAL_SAVES_ENABLED` | `false` | Enable trusted local-save browsing/path analysis only when exactly `true` |
| `HOI4_SAVES_DIR` | `../saves` from backend cwd | Local-save browser root |
| `HOI4_UPLOAD_DIRECTORY` | OS temp | Managed multipart files |
| `HOI4_MAX_UPLOAD_BYTES` | 256 MiB | Raw upload limit |
| `HOI4_MAX_UNCOMPRESSED_BYTES` | 512 MiB | Plain/decompressed limit |
| `HOI4_UPLOAD_TIMEOUT_MS` | 120,000 | Upload deadline |
| `HOI4_ANALYSIS_REQUESTS` | `2` | Concurrent admitted requests |
| `HOI4_ANALYSIS_WORKERS` | `1` | Active Workers; invalid values fail startup |
| `HOI4_ANALYSIS_TIMEOUT_MS` | 60,000 | Worker deadline |
| `HOI4_ANALYSIS_HEAP_MB` | 1,024 | Worker old-generation limit |
| `HOI4_ANALYSIS_CACHE_ENTRIES` | `3` | Completed RAM cache entries |
| `HOI4_RECENT_ANALYSES_FILE` | `data/recent-analyses.json` | Recent metadata |
| `HOI4_RECENT_ANALYSES_LIMIT` | `200` | Recent metadata limit |
| `HOI4_ANALYSIS_RESULTS_DIR` | `data/analysis-results` | Gzip result artifacts |
| `HOI4_ANALYSIS_RESULTS_MAX_BYTES` | 128 MiB | Compressed artifact budget |
| `HOI4_SHARED_ANALYSES_FILE` | `data/shared-analyses.json` | Share metadata |
| `HOI4_SHARED_ANALYSES_LIMIT` | `1,000` | Active shares |

## Runtime boundaries

- `SaveUploadInterceptor` owns pre-multipart admission, upload limits, managed temporary files, abort handling, and cleanup.
- `AnalysisResultCacheService` hashes original save bytes, provides completed LRU reuse, and deduplicates in-flight identical saves.
- `Hoi4AnalysisWorkerService` owns bounded Worker lifecycle, timeout/error/exit races, termination, and slot release.
- `hoi4-parser.ts` and its domain modules decode once, reuse structural indexes, and build deterministic public results.
- `PersistedAnalysisResultService` writes versioned gzip envelopes atomically and enforces the compressed byte budget.
- `RecentAnalysesService` stores compact metadata and reconciles availability, legacy context, pins, shares, and bulk cleanup.
- `DatabaseService` owns the optional PostgreSQL pool lifecycle and startup/health validation. It does not run migrations or store analysis artifacts.
- `AuthService` owns registration, credential verification, opaque-token issuance, expiry enforcement, and current-session revocation. Controllers never execute SQL or hash tokens.

The persistence implementation is single-process. Do not run multiple backend instances against the same directory.

## API

The important routes are documented in the [root README](../README.md#important-api-routes). Internal telemetry routes under `/api/records` and `/api/soldiers` support the optional Python tracker and are separate from persisted Campaign Trends.

## Persistence safety

Original multipart uploads are temporary and are not part of Recent persistence. Result artifacts are named by validated SHA-256, compressed with gzip, and written through an exclusive temporary file plus fsync and atomic rename. Storage inventory accepts only recognized regular files and does not follow symbolic links.

Pins and active shares receive stronger retention protection, but the hard configured byte limit remains authoritative. Storage failures do not corrupt a successful parser result; availability is represented explicitly.

## PostgreSQL metadata

PostgreSQL is disabled by default for native/local compatibility. Set `HOI4_DATABASE_ENABLED=true` with a valid `DATABASE_URL` to require connectivity; invalid configuration or connection failure stops startup without exposing the URL. Compose enables it with clearly development-only defaults and runs a separate migration container first.

Versioned SQL migrations live in `migrations/`. Build and apply them with `npm run db:migrate:dev`; after a build, inspect with `npm run db:migrate:status`. Database integration tests require an isolated `HOI4_TEST_DATABASE_URL` whose database name ends in `_test`, then run with `npm run test:db`.

The existing `users` and `sessions` schema backs the Phase 2A auth endpoints. Passwords are versioned salted scrypt hashes. Raw 256-bit session tokens are sent only in the `hoi4_session` HttpOnly cookie; PostgreSQL stores their SHA-256 hashes and fixed expiry timestamps. Emails are trimmed/lowercased and remain protected by the database `CITEXT` unique constraint.

Auth routes are `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, and `POST /api/auth/logout`. With database mode disabled, only these auth operations return a generic 503; the existing local application remains usable. The cookie is `SameSite=Lax`, `Path=/`, has matching expiry attributes, and becomes `Secure` by default in production. Local HTTP Compose explicitly sets `HOI4_SESSION_COOKIE_SECURE=false`; an HTTPS deployment must set it to `true`.

Phase 2A does **not** apply authentication globally. Analyzer, Recent, Compare, Trends, storage, and share-management APIs remain unauthenticated and global. Ownership, CSRF enforcement, authorization guards, quotas, and frontend auth UX are deliberately deferred to Phase 2B/3. AnalyzeResult gzip artifacts, Recent metadata, and Share metadata remain filesystem-based and behaviorally unchanged. Backups for a future SaaS deployment need both PostgreSQL and artifact storage.

## Public-deployment warning

Local-save filesystem APIs are disabled unless `HOI4_LOCAL_SAVES_ENABLED=true`. When disabled, `/api/saves`, `/api/saves/default-dir`, `/saves/analyze`, and JSON `path` analysis through `/api/analyze` return 404; multipart uploads remain available. Keep local mode disabled for public/SaaS deployments because enabling it exposes server-side save browsing/path analysis.

The backend has resource/input hardening plus an authentication core, but no product-route authorization, ownership, per-user isolation, CSRF enforcement, distributed admission, or cross-process locking. Treat it as a local/single-owner service until those later security phases are implemented.
