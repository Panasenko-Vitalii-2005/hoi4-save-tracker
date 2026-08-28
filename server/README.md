<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run build
$ npm run start:prod
```

### Save analysis workers

On a cache miss, `POST /api/analyze` runs the existing save parser in a new Node.js
Worker Thread. Only the file path is sent; the worker reads/decodes the save and
returns the unchanged analysis result. Uploaded files are removed after analysis
settles, including on cache hits, parse errors or crashes.

`HOI4_ANALYSIS_WORKERS` is a positive integer, default **1**, limiting active
analyses per backend process. Excess cache misses for different contents receive
**503** and may be retried; there is no waiting queue or worker pool. With the
default, two simultaneous distinct uncached saves admit one and reject one;
five admit one and reject four. Identical contents share an in-flight analysis,
and completed cache hits do not use a worker slot. Raising the
limit permits parallel analyses but multiplies large-save heap usage and CPU
demand. Do not size it solely by logical CPU count. No new analysis timeout is
imposed. Result deserialization and HTTP JSON serialization still use the main thread.

Nest start/watch and production use emitted workers under
`dist/src/hoi4/workers/`. `npm run start:prod` runs `dist/src/main.js`, matching
the existing Docker entry. Source execution (including Jest) uses the existing
dev-only `ts-node` loader; production workers do not require it.

### Analysis result cache

Both JSON/path requests and uploads use a streaming SHA-256 of the raw file bytes
before analysis. Filenames, paths and timestamps are not cache keys. Identical
bytes share a result even under different names; different compressed encodings
of the same decoded save are separate entries. Hashing reads the file once in
bounded chunks without allocating a full-file buffer; a cache miss then lets
the worker read/decode the file as before. Local saves must remain unchanged
during hashing and analysis; use a stable copy rather than a file being rewritten.

`HOI4_ANALYSIS_CACHE_ENTRIES` is a positive integer, default **3**. Missing or
invalid values fall back to 3. The cache holds only successful results, evicting
the least recently accessed entry when full. It is **process-local memory**, not
durable storage: restart clears it, and separate backend processes do not share
it. The control save's result is about 6.55 MiB serialized / 11.1 MiB retained
heap in a sample measurement; three such entries are roughly 33 MiB of result
heap, in addition to workers, in-flight results and HTTP serialization. This is
an entry-count bound, not a byte limit; modded results may be larger.

Concurrent requests with the same hash await one analysis. Failures (including
503 and worker crashes) are neither cached nor retained as in-flight entries,
so a later request can retry. Each upload retains and cleans up only its own
temporary file after its awaited analysis settles. A duplicate caller or client
disconnect does not cancel the worker or delete another caller's file.

Results are treated as immutable and serialized directly, without expensive
deep copies. Cache code never modifies them. `parse_seconds` remains the duration
of the original parser execution, **not** current request latency or a cache-hit
indicator. The response shape is unchanged; upload, hashing and serialization
still take time on a hit. No cache state or hashes are logged or added to the
analysis response.

### Recent Analyses history

Successful `POST /api/analyze` interactions also update a small persistent metadata
history, separate from the in-memory result cache. Cache hits refresh it too.
Identity is the same raw-byte SHA-256: identical contents update one entry's name,
timestamp and counters; different contents with the same name remain distinct.
The existing analysis response and `parse_seconds` are unchanged.

- `HOI4_RECENT_ANALYSES_FILE`: defaults to `data/recent-analyses.json`, relative to
  the backend working directory (`server/data/recent-analyses.json` when started
  from `server/`). An absolute path is recommended for deployments.
- `HOI4_RECENT_ANALYSES_LIMIT`: positive integer, default **20**; invalid values
  fall back to 20. The total includes pinned entries. Pins are retained first,
  then newest unpinned entries. Oldest unpinned entries are evicted first; if
  pinned entries alone exceed a lowered limit, oldest pins are evicted too.
  If pins already fill the count limit, a new unpinned analysis is returned
  normally but is not added to history or durable storage.
  This is independent of `HOI4_ANALYSIS_CACHE_ENTRIES`.
- `GET /api/analyze/recent` returns `{ "items": [...] }` with hash, basename, exact
  byte size, UTC ISO `analyzedAt`, game date, active-country count, division count,
  ship count, naval-loss count, `hasPersistedResult` availability and `pinned`.
- `DELETE /api/analyze/recent` clears metadata **and durable result files**. It
  does not remove original saves or evict the independent RAM cache. A later
  successful analysis (including a cache hit) can add a persisted entry again.
- `DELETE /api/analyze/recent/:hash` deletes one metadata entry, its durable
  result and its completed RAM-cache entry, including when pinned. It is
  idempotent: an unknown valid hash also returns **200**, with `{ "items": [...] }`.
  Original saves and unrelated entries are untouched. Already rendered frontend
  results remain visible. In-flight analyses are not cancelled: a subsequently
  completing analysis can create a fresh history/cache entry again.
- `PATCH /api/analyze/recent/:hash` accepts only `{ "pinned": true }` or
  `{ "pinned": false }`, returning `{ "items": [...] }`. Unknown hashes return
  **404**; malformed hashes or extra/non-boolean fields return **400**. Both
  management endpoints reuse SHA-256 validation and return generic **503** errors
  for failed writes, without storage paths. Pinning does not change analysis time.

No raw saves, decoded save text, temporary upload paths, stack traces or Worker
details are persisted. Full analysis results are stored separately as described
below. Filenames and campaign data are local user data: keep storage private.
The current deployment has one shared
local history, not per-user ownership or authentication.

Writes are serialized within one backend process, written to a unique adjacent
temporary file, flushed with fsync, closed, then renamed over the store. A failed
update leaves the previous store intact and does not fail save analysis. Missing
files start empty; corrupt/unreadable files produce one startup warning and an
empty history. The next successful write replaces corrupt history. Write errors
produce one useful warning per service lifetime. Do not point multiple backend
processes at the same file: cross-process locking is not provided.

Only successful analyses are recorded; parser/hash errors, Worker crashes, 503s
and callers disconnected before successful completion do not create entries.
Request-specific temporary-file cleanup and shared in-flight analysis remain
unchanged. A disconnect does not cancel another caller's analysis.

The Analyzer's **Recent Analyses** section loads independently and refreshes after
success. It shows filenames, game dates, locally formatted timestamps, divisions
and ships. **Open result** loads a saved analysis without the original save or a
Worker. Opening has its own loading/error state, guards duplicate clicks and
replaces the current result only after success. A new upload supersedes a pending
Open. An unavailable result refreshes history; legacy entries without availability
remain visible with no Open action until re-analysis.

Search matches filename (case-insensitive) or game date locally, never SHA-256.
Sort by newest/oldest analysis, filename A–Z/Z–A, or newest/oldest game date. Game
dates are compared as numeric year/month/day, not strings; missing/invalid dates
stay last. Pinned entries lead in every sort mode, sorted within their group.
Rows also show human-readable original file size, naval losses and explicit
Available/Unavailable status. Search and sort have labels; actions use native
buttons, async status announcements and a keyboard-focusable scrolling table.

**Delete** requires confirmation and has a local failure message. **Pin/Unpin**
is guarded while pending and updates only on success. Mutations cancel stale
history-list reads and refetch afterward, so concurrent analysis completion is
not lost. No Clear All UI was added; the existing DELETE collection API still
clears pinned and unpinned entries. Missing `pinned` in old metadata defaults to
false without requiring migration or rewriting just for the missing field.

Delete, pin/unpin, analysis completion and clear share the existing serialized
history mutation queue. A same-hash re-analysis reads the latest pin state inside
that queue and preserves it. No database or cross-process synchronization is added.

Compose stores history in the `analysis-history` named volume at
`/app/data/recent-analyses.json` and results at `/app/data/analysis-results`, surviving
container recreation. Removing that volume (for example, `docker compose down -v`)
removes both history and results. Runtime data is
excluded from Git and Docker build context; no history is baked into images.

### Durable analysis results

Successful analyses, including RAM-cache hits, persist full JSON-compatible
`AnalyzeResult` values as gzip-compressed UTF-8 JSON using Node's **async** zlib
APIs with default compression. One file per validated raw-save SHA-256:
`<hash>.json.gz`. The versioned envelope is
`{ formatVersion: 1, hash, savedAt, result }`; the result shape and original
`parse_seconds` are unchanged. Future incompatible formats must use a new version.
Raw `.hoi4` files are **not** retained.

- `HOI4_ANALYSIS_RESULTS_DIR`: defaults to `data/analysis-results` relative to the
  backend working directory (`server/data/analysis-results` in local development).
  Compose sets `/app/data/analysis-results` in the existing named data volume.
- `HOI4_ANALYSIS_RESULTS_MAX_BYTES`: positive safe integer, default **134217728**
  (128 MiB); invalid values fall back to that default. This bounds retained
  compressed result files independently of the history-count limit. The control
  result is about 6.55 MiB JSON / 481 KiB gzip; 20 such results need about 9.4 MiB,
  leaving headroom for larger saves. One in-progress atomic replacement can
  temporarily add one file. A separate 512 MiB uncompressed envelope safety ceiling
  bounds gzip expansion; an oversized result is still returned by POST but not
  persisted. No arbitrary-size result is assumed to fit.
- `GET /api/analyze/recent/:hash/result`: returns the unchanged `AnalyzeResult`.
  Hashes must be exactly 64 hexadecimal characters (uppercase is normalized).
  Malformed hashes return **400**. Missing, corrupt, incompatible or unrecorded
  results return **404**, with a generic message and no storage paths.

Writes are serialized per process: JSON → async gzip → exclusive temporary file →
fsync → close → atomic rename. Re-analyzing the same hash atomically replaces its
one file. Storage failure never fails a successful analysis; metadata advertises
`hasPersistedResult: false`. A failed metadata write is reconciled to avoid orphans.
No cross-process locking is provided: use one backend per storage directory.

Unpinned results are evicted by oldest analysis timestamp first to reserve space
within the byte budget. Pins are protected when possible, but the hard byte cap
still wins: oldest pinned results are removed if necessary, with metadata retained
and `hasPersistedResult: false`. A new unpinned result is declined if retaining it
would displace protected pins; its analysis still succeeds with unavailable reopen.
History-count eviction deletes the corresponding files too; disk eviction
keeps metadata but removes its Open availability. Loading/listing history reconciles
missing files, lowered limits, orphan result files and stale managed temporary
files. Only recognized regular files are deleted; unrelated files/directories and
symlinks are not followed. Crash leftovers are cleaned at reconciliation.

Read validation checks the envelope version, hash, timestamp and required result
shape. Invalid gzip/JSON or incompatible data is unavailable, produces one generic
read warning per service lifetime, and clears availability. Re-analysis can repair
it. Legacy metadata requires no migration or original save on startup.

Reopen always reads/decompresses the durable file; it does **not** populate or
change the upload result cache, preserving its existing semantics. No Worker or
original save read occurs. `parse_seconds` is the original parse duration, not
reopen latency. JSON stringify/parse and HTTP serialization still run on the main
thread; gzip/gunzip are asynchronous. This remains local single-user storage,
without authentication, encryption or multi-user access isolation.

### Compare saved analyses (MVP)

`GET /api/analyze/compare?base=<sha256>&target=<sha256>` loads durable results
through `PersistedAnalysisResultService`, then returns a compact comparison DTO.
It never reads original saves, invokes the parser/Worker, or depends on the RAM
analysis cache. Equal hashes are valid and loaded once. Existing hash validation
is reused: invalid/missing/repeated hash parameters return **400**; a missing or
corrupt result returns a generic **404**; unexpected failures return a generic
**503**, without paths. No persistence format or AnalyzeResult changes are made.

The pure comparison model uses:

- `game_date` for each side (preserved as the existing raw display date);
- `active_countries`, `totals.divisions`, `totals.manpowerInField`,
  `totals.aircraft`, `totals.ships`, and `navalLosses.length` for global summary;
- the union of `by_country[].tag`, sorted ascending by exact tag;
- per-country `effectiveMilitaryFactories`, `effectiveCivilianFactories`,
  `effectiveDockyards`, `divisions`, `manpowerInField`, `ships`, and
  `calculatedWarCasualtiesTotal`.

Every numeric difference is **target minus base**, without date reordering.
Only finite numbers participate in arithmetic; unknown/missing values stay null.
For **every** compared country metric an absent country means unavailable, not
zero: absence from this result is not proof that its historical quantities were
zero. Added/removed countries remain explicit. `unchanged` denotes continued tag
identity; `hasChanges` tracks metric differences (including availability changes)
or added/removed status. Names are presentation only, resolved by the existing
frontend country-name mapping; aliases with different tags are not merged.

Industry uses final effective totals; no industry formulas are repeated.
Calculated casualties retain bilateral-record semantics. Naval losses compare
the count of retained events, **not** proven sinkings between saves or lifetime
losses. No campaign-identity check is inferred. A date-only difference does not
count as a change in compared numeric metrics. The unused nullable
`manpowerCasualties` placeholder and a global casualty sum are deliberately not
compared; no detailed production, stockpile, army, fleet, war, or map diff is added.

Recent Analyses offers two explicit **Base / Target** selectors containing only
available entries. Each slot can be replaced or cleared; there is no third slot.
The same analysis can occupy both slots. **Swap** reverses direction; **Compare**
requires both valid selections and guards duplicate requests. Selection changes
abort pending reads, and late responses are ignored. History deletion or changed
availability invalidates affected selections. A failed comparison keeps the last
successful comparison with its original names/dates, never the new request's
labels; unavailable results trigger a history refresh.

Results appear in a separate section, with neutral signed deltas, global metrics,
an exact-country table, **Changed only** (default) / **All countries**, and
country-name/tag search. Native labelled controls, polite async announcements,
and a focusable horizontally scrolling table support narrow screens and keyboard
use. Existing upload/Open results coexist with this separate comparison section:
opening or uploading another save does not clear the completed comparison or
overwrite its Base/Target labels. No raw AnalyzeResult payloads or hashes are
displayed as normal user-facing labels.

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
