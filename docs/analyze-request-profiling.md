# Temporary analyze request profiling

Enable `HOI4_REQUEST_PROFILE=1` to emit **one** `[REQUEST_PROFILE] analyze {…}`
JSON summary for each `POST /api/analyze` (including query parameters and the
compact batch response mode). Other routes are not profiled. Without the exact
value `1`, no request context, response wrapper, or profiling log is created.
This is measurement only; it does not enable/change `HOI4_PROFILE`, parsing,
caching, persistence, admission, telemetry, or response contracts.

## Boundaries and interpretation

Times are monotonic milliseconds, rounded to 0.1 ms. `null` means the operation
was not performed, did not complete before disconnect, or was not measurable;
it does **not** mean zero cost. Phases are nested/overlapping, not additive.
The short random `requestId` identifies this request only; no user/session IDs,
tokens, filenames, paths, save contents, or exception messages are logged.

| Field | Exact boundary |
| --- | --- |
| `requestEnteredMs` | `0`, the relative origin: first Express middleware registered in `main.ts`, before Nest body parsers, security middleware, guards, and multipart interception. Node has already received/parsed HTTP headers. |
| `multipartCompleteMs`, `phases.multipartMs` | Entry → successful Multer completion, with the whole multipart body received and file pipeline finished. Includes pre-upload auth/CSRF, initial telemetry, and admission time. `null` for JSON/path requests or incomplete uploads. |
| `fileBytes` | Actual completed temp-file writer bytes, or local file size for JSON/path requests. Never total multipart envelope size or a claimed Content-Length. `null` when unavailable. |
| `admissionMs` | Upload interceptor's existing fail-fast request/body-size admission through adding its session; excludes preceding telemetry. There is no admission waiting queue. |
| `validationMs` | Controller `validateSaveFileFormat` call before hashing, including validation I/O; excludes local path resolution/stat outside that call. Worker-side validation remains inside parser timing. |
| `sha256Ms`, `hashPrefix` | Streaming SHA-256 read of the staged/local file; first 12 hex characters set only after success. No additional file read is introduced. |
| `cacheLookupMs`, `cacheHit`, `cacheStatus` | Completed/in-flight Map lookup. Completed hit is `true`/`hit`; own analysis is `false`/`miss`; coalesced request is `false`/`in_flight`. |
| `sharedAnalysisWaitMs` | An in-flight follower's wait for the existing analysis Promise. It did not start a Worker. |
| `workerAdmissionMs` | Worker's existing fail-fast closing/capacity check; no Worker queue exists. |
| `workerMs` | Immediately before Worker construction → result/error handling, thread termination and slot release. Includes startup, module loading, parsing, message transfer and termination. Present on failed execution too; `null` on completed cache hits and followers. |
| `parserMs` | Successful **current** Worker result's existing `parse_seconds × 1000` (10 ms resolution). Covers `analyzeSave`, including save reading/validation, but not the whole thread lifecycle. Never taken from a cached result. `null` for failed parsing/hits/followers. |
| `workerOutsideParserMs` | `max(workerMs − parserMs, 0)`, approximate residual; parser rounding limits precision. Not a separate directly measured phase. |
| `artifactLoadMs` | Existing persisted result reads: wait for artifact mutation queue, read/inflate/validate, or context-prefix read. Accumulated if actually called within the request; does not add reads. Normal POST cache hits use memory, so usually `null`. |
| `persistenceMs` | Controller's whole `history.record` call, including queue, retention, artifact save/reconciliation, recent metadata and ownership callback. Existing behavior persists artifacts on cache hits too. |
| `historyQueueWaitMs` | Enqueueing this history record → beginning its serialized mutation callback. |
| `artifactQueueWaitMs` | Enqueueing artifact save → beginning its serialized save callback. |
| `artifactPersistenceMs` | Artifact callback start → completion/failure: ownership protection lookup, envelope serialization/gzip, inventory/budget enforcement, write/fsync/rename and temp cleanup. Excludes its queue wait. |
| `artifactSerializationMs`, `artifactCompressionMs` | Existing envelope `JSON.stringify` and existing async gzip respectively, inside artifact persistence. No duplicate serialization/compression. |
| `historyMetadataMs` | Existing atomic Recent metadata persistence call (mkdir/temp write/fsync/rename/cleanup). |
| `ownershipDatabaseMs` | Final `assignOwnership` callback/ownership write. Not all DB work: auth, protection lookups and product-event writes occur in their containing intervals. |
| `telemetryMs` | Existing awaited started/terminal telemetry calls, accumulated. Event names/properties/order remain unchanged. |
| `responsePreparationMs` | Existing Express `res.json`: JSON serialization and synchronous send/header/end preparation. No extra response serialization is used to measure size. |
| `responseBytes` | Numeric response Content-Length, when valid. JSON body bytes, not headers/TLS bytes, proxy compression or confirmed bytes received by browser. Otherwise `null`. |
| `responseFinishedMs`, `backendTotalMs` | Entry → Node response `finish` (handed to the downstream socket/OS, **not** browser receipt). On premature `close`, finish is `null`, total ends at close and outcome is `aborted`. Only one summary is emitted. |
| `statusCode`, `outcome`, `errorCode` | HTTP status and completed/failed/aborted outcome; fixed allowlisted analyzer error code where available, otherwise `HTTP_<status>`. No raw errors. An aborted response's status is not proof it was delivered. |

### What upload timing can and cannot prove

The middleware precedes Multer and observes delayed body arrival, including
temporary-file staging. It does **not** timestamp the first TCP byte or browser
click: Express only receives a request after Node parses its headers. It cannot
measure browser work, DNS/TLS, earlier network delay, upstream buffering, or
browser download/render completion.

The repository Private Alpha Caddy `/api/*` route streams directly to the backend;
the local nginx API route disables request/response buffering. Preserve the
intentional VPS Caddy override. If an additional proxy/CDN buffers the upload
before forwarding headers/body, its delay will not appear in Node timing.
Therefore compare a user stopwatch with the correlated backend total, without
claiming that a short Node interval rules out upstream/network delay.

On a memory-cache hit, upload, validation, hashing, persistence/ownership,
telemetry and response sending still run. No persisted-artifact read or Worker
is performed simply because there is a hit. Authentication, retention and temp
cleanup have no dedicated sub-timer; they remain included in the total and their
containing intervals. Do not subtract the sum of all phases from the total.

### Example logs

Actual local compiled HTTP checks with a **57-byte synthetic fixture** and mock
ownership/telemetry providers (not a VPS/large-save benchmark). Both responses
were identical, including the analysis hash. Notice that the hit still persisted
the artifact, while its Worker/parser fields are unavailable:

```text
[REQUEST_PROFILE] analyze {"requestId":"909b1aa28447","requestEnteredMs":0,"multipartCompleteMs":16.7,"fileBytes":57,"hashPrefix":"847c93734ee5","cacheHit":false,"cacheStatus":"miss","phases":{"admissionMs":0.1,"multipartMs":16.7,"validationMs":1.4,"sha256Ms":1.7,"cacheLookupMs":0,"sharedAnalysisWaitMs":null,"workerAdmissionMs":0,"workerMs":104.1,"parserMs":10,"workerOutsideParserMs":94.1,"artifactLoadMs":null,"artifactQueueWaitMs":0.1,"artifactPersistenceMs":5.6,"artifactSerializationMs":0,"artifactCompressionMs":1.4,"historyQueueWaitMs":0.1,"historyMetadataMs":3.5,"ownershipDatabaseMs":0.1,"persistenceMs":12,"telemetryMs":0.2,"responsePreparationMs":3},"responseFinishedMs":143.3,"backendTotalMs":143.3,"responseBytes":984,"statusCode":201,"outcome":"completed","errorCode":null}
[REQUEST_PROFILE] analyze {"requestId":"ff5195be3343","requestEnteredMs":0,"multipartCompleteMs":3.2,"fileBytes":57,"hashPrefix":"847c93734ee5","cacheHit":true,"cacheStatus":"hit","phases":{"admissionMs":0.1,"multipartMs":3.2,"validationMs":0.4,"sha256Ms":0.6,"cacheLookupMs":0,"sharedAnalysisWaitMs":null,"workerAdmissionMs":null,"workerMs":null,"parserMs":null,"workerOutsideParserMs":null,"artifactLoadMs":null,"artifactQueueWaitMs":0,"artifactPersistenceMs":4.5,"artifactSerializationMs":0,"artifactCompressionMs":0.4,"historyQueueWaitMs":0,"historyMetadataMs":6.7,"ownershipDatabaseMs":0,"persistenceMs":12.7,"telemetryMs":0.1,"responsePreparationMs":2},"responseFinishedMs":20.1,"backendTotalMs":20.1,"responseBytes":984,"statusCode":201,"outcome":"completed","errorCode":null}
```

## Temporary Private Alpha enable/disable

Do not run these commands as part of local verification. Deploy the instrumented
source/image using the normal approved process first. In the VPS checkout, create
`/tmp/hoi4-request-profile.compose.yml` with exactly:

```yaml
services:
  backend:
    environment:
      HOI4_REQUEST_PROFILE: "1"
```

Recreate only the backend (no volume deletion/migration, edge changes, or parser
profiling flag needed):

```bash
docker compose --env-file .env.private-alpha \
  -f docker-compose.yml -f docker-compose.private-alpha.yml \
  -f /tmp/hoi4-request-profile.compose.yml \
  up -d --no-deps --build backend

docker compose --env-file .env.private-alpha \
  -f docker-compose.yml -f docker-compose.private-alpha.yml \
  -f /tmp/hoi4-request-profile.compose.yml \
  logs --no-log-prefix -f backend | grep --line-buffered '\[REQUEST_PROFILE\] analyze '
```

If your deployment uses additional approved Compose overrides/project options,
retain them in **both** commands (and when disabling); add the profiling override
last. Do not replace production secrets or the existing Caddyfile.

After collecting fresh/hit requests, disable by recreating the backend without
the temporary override. Assuming the two repository Compose files are the entire
deployment configuration:

```bash
docker compose --env-file .env.private-alpha \
  -f docker-compose.yml -f docker-compose.private-alpha.yml \
  up -d --no-deps backend
```

This flag is diagnostic only. Expected overhead is one AsyncLocalStorage context,
a small fixed number of timers, one existing `res.json` wrapper and one bounded
log line. There is no per-chunk/per-division logging, extra hashing, file read,
serialization or parser execution. Logging/context overhead depends on the VPS;
do not assume zero or claim a production benchmark from local fixture results.
