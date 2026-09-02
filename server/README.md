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

The persistence implementation is single-process. Do not run multiple backend instances against the same directory.

## API

The important routes are documented in the [root README](../README.md#important-api-routes). Internal telemetry routes under `/api/records` and `/api/soldiers` support the optional Python tracker and are separate from persisted Campaign Trends.

## Persistence safety

Original multipart uploads are temporary and are not part of Recent persistence. Result artifacts are named by validated SHA-256, compressed with gzip, and written through an exclusive temporary file plus fsync and atomic rename. Storage inventory accepts only recognized regular files and does not follow symbolic links.

Pins and active shares receive stronger retention protection, but the hard configured byte limit remains authoritative. Storage failures do not corrupt a successful parser result; availability is represented explicitly.

## Public-deployment warning

The backend has resource and input hardening, but no authentication, ownership, per-user isolation, distributed admission, or cross-process locking. Treat it as a local/single-owner service unless a separate security architecture is added.
