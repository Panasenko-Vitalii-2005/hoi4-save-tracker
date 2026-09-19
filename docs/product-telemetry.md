# Product telemetry

## Purpose and boundary

Private-alpha product telemetry answers a small set of operational product
questions: whether authenticated analysis attempts start, complete, are rejected,
or fail; whether completed analyses are opened and explored; and whether public
sharing is used. It is PostgreSQL-backed and first-party only. There is no
external analytics vendor or generic event-ingest endpoint.

Telemetry is deliberately separate from technical application logs. Events use
stable codes and stages; exception messages and stack traces remain in the
normal diagnostic logging boundary and are never event properties.

## Data model

`analyses` stores one canonical row per analyzed save content hash:

- `id` and the unique SHA-256 `content_hash`;
- uploaded file size in bytes;
- parser-reported parse duration in milliseconds;
- division count;
- validated container format: `plain_text` or `zip_text`;
- creation time.

These are stable or analysis-scoped characteristics. The first successfully
recorded metadata is retained when the same content hash is analyzed again.
There is no fabricated read duration: the current pipeline does not measure
that phase independently.

`product_events` is an immutable event stream with:

- event name and server occurrence time;
- nullable user, analysis, and session foreign keys;
- a required UUID `flow_id` for one request attempt;
- a nullable random browser-session UUID for client event correlation;
- a small validated JSON object of event-specific properties.

The HTTP authentication boundary currently exposes the safe user identity but
does not propagate the database session ID to controllers. `session_id` is
therefore intentionally null rather than derived from a cookie or token.

## Supported events

| Event                      | Semantics                                                                                                                        | Properties                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `analysis_upload_started`  | An authenticated request reached analysis admission.                                                                             | Optional `fileSizeBytes`, optional `saveFormat`. These are normally unknown at initial multipart admission. |
| `analysis_upload_rejected` | The request was not accepted as a valid analysis input or could not be admitted.                                                 | `errorCode`, `failureStage`, optional known size/format.                                                    |
| `analysis_completed`       | Analysis returned successfully to the interceptor. Canonical analysis metadata is written in the same transaction as this event. | `totalDurationMs` for the complete request attempt.                                                         |
| `analysis_failed`          | Accepted processing, persistence, or infrastructure failed.                                                                      | `errorCode`, `failureStage`, optional known size/format.                                                    |
| `analysis_opened`          | An owned, persisted analysis became meaningfully visible in the authenticated analyzer.                                          | None.                                                                                                       |
| `analysis_section_viewed`  | An authenticated user meaningfully viewed one allowlisted analysis section.                                                      | `section`.                                                                                                  |
| `analysis_shared`          | A public link was successfully created or activated for an owned analysis.                                                       | None.                                                                                                       |
| `shared_analysis_opened`   | A valid public link successfully returned its read-only analysis. The user is anonymous.                                         | None.                                                                                                       |

The section enum is exactly `overview`, `war-casualties`, `naval-losses`,
`stockpile`, `production`, and `land-forces`.

Authenticated client events use `POST /api/product-events/client`. The body is
an event-specific closed contract: a supported event name, owned analysis hash,
random browser-session UUID, and (only for section views) an allowlisted
section. Authentication and CSRF protection are unchanged. The server derives
the user from the authenticated request, resolves the canonical `analysis_id`
from the hash, and supplies `occurred_at`; user IDs, timestamps, arbitrary
properties, backend-only event names, and foreign analysis hashes are rejected.

Public opens do not use a public ingest endpoint. The existing
`GET /api/share/:id` records an anonymous open only after the opaque share ID
resolves to a live persisted result. The browser may attach only its random
session UUID in `X-Product-Session`; malformed or absent correlation is ignored
without affecting access to the shared result.

Failure stages are `admission`, `upload`, `validation`, `analysis`, and
`persistence`. Error codes are the existing safe save-input/API codes (for
example `INVALID_SAVE`, `UNSUPPORTED_BINARY_SAVE`, `FILE_TOO_LARGE`,
`ANALYSIS_TIMEOUT`, and `ANALYSIS_FAILED`) plus `SAVE_NOT_FOUND`. Raw exception
text is not accepted by the contract.

Each request creates one UUID flow before admission and attempts to record one
start event. In the normal process lifetime it records at most one terminal
event: rejected, completed, or failed. A process crash or unavailable database
can leave an incomplete flow; this phase does not claim distributed exactly-once
delivery. Telemetry writes are best effort: they log a safe warning and never
turn an otherwise successful analysis into a user-visible failure.

## Browser session and deduplication

The SPA generates `crypto.randomUUID()` once and keeps it in `sessionStorage`.
It is product-event correlation only: it is not authentication, is not derived
from IP address, user agent, or fingerprinting inputs, and disappears with the
browser session.

The client marks an analysis/event/section combination before best-effort
delivery, so React rerenders and navigation oscillation do not produce obvious
noise. PostgreSQL partial unique indexes independently enforce one open, share,
public open, and one view of each section per analysis/browser session. A new
browser session can record a revisit. This is deliberately at-most-once within
one browser session, not distributed exactly-once delivery: a network failure
may lose an event and does not trigger UI failure or automatic retries.

## Privacy

Product telemetry does **not** collect:

- save contents or arbitrary request bodies;
- filenames;
- country, division, state, or other raw save records;
- email addresses in event properties;
- IP addresses as analytics properties;
- browser fingerprints or user-agent analytics;
- stack traces or raw exception messages;
- cookies, session tokens, secrets, or filesystem paths.

The nullable user foreign key is the authenticated internal UUID. Application
logging and PostgreSQL operational logging have separate policies.

## Retention

The intended retention for raw rows in `product_events` is **90 days**. Phase 2A
does not add a scheduler or purge job because the repository has no existing
general retention-job framework. Automated, observable deletion of rows older
than 90 days is follow-up work. Canonical `analyses` metadata is not raw event
history and is outside that raw-event retention statement.

## Example queries

The complete read-only private-alpha report is
[`product-telemetry-report.sql`](product-telemetry-report.sql). It includes:

- successful analyses and terminal outcomes per UTC day;
- safe rejection/failure code breakdowns;
- file-size, parser-duration (median/p95), and division-count aggregates;
- registration-to-first-success activation;
- cross-session and cross-day analysis revisits;
- allowlisted section use relative to opened analyses/users;
- share activations and anonymous public opens.

It reads only canonical metadata and typed product events; it does not
decompress saved analyses or access save files.

Completed analysis attempts per UTC day:

```sql
SELECT date_trunc('day', occurred_at) AS day, count(*) AS completed
FROM product_events
WHERE event_name = 'analysis_completed'
GROUP BY 1
ORDER BY 1;
```

Terminal outcome rate and safe failure/rejection codes:

```sql
WITH outcomes AS (
  SELECT
    event_name,
    properties->>'errorCode' AS error_code,
    count(*) AS attempts
  FROM product_events
  WHERE event_name IN (
    'analysis_upload_rejected',
    'analysis_completed',
    'analysis_failed'
  )
  GROUP BY 1, 2
)
SELECT
  event_name,
  error_code,
  attempts,
  round(100.0 * attempts / sum(attempts) OVER (), 2) AS terminal_rate_percent
FROM outcomes
ORDER BY attempts DESC;
```

Median and p95 parser duration across canonical analyzed contents:

```sql
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY parse_duration_ms) AS median_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY parse_duration_ms) AS p95_ms
FROM analyses;
```

Users with at least one completed analysis:

```sql
SELECT count(DISTINCT user_id) AS users_with_completed_analysis
FROM product_events
WHERE event_name = 'analysis_completed'
  AND user_id IS NOT NULL;
```

## Known limitations and follow-up

- Raw-event 90-day deletion is documented but not automated yet.
- Database authentication-session linkage remains null; the separate random
  browser-session UUID is intentionally not an authentication identifier.
- Browser-session dedup trades exact interaction counts for low-noise private
  alpha signals. A failed best-effort request is not retried.
- Public-open abuse is bounded to valid high-entropy share links and a closed
  event contract. There is no per-client rate limiter in this phase; revisit if
  private-alpha traffic or deliberate UUID rotation creates material noise.
- No dashboard, generic event framework, external vendor, or analytics API is
  introduced in this phase.

The 90-day raw-event policy remains operational follow-up. When a scheduler is
introduced, its required deletion is:

```sql
DELETE FROM product_events
WHERE occurred_at < now() - interval '90 days';
```

The purge must run as an observable, failure-alerting maintenance job. This
phase does not add scheduling infrastructure solely for that statement.
