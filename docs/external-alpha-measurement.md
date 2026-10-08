# External alpha C1: durable activation and campaign return

This is measurement for one **20-person controlled study**, not proof of demand,
understanding, willingness to pay, population retention or legal compliance.
No new Intelligence rules, gameplay metrics or third-party tracking are added.

## Facts and event contracts

- `analysis_completed` still means computation returned. Its new optional
  `persistenceOutcome` is `saved` or `temporary`; old events without it have
  **unknown** persistence. Never count completion alone as durable activation.
- `analysis_ownership.durable_acquired_at` is set by the A2 confirmed artifact +
  Recent metadata + ownership/history commit. It is immutable while that ownership
  exists, including cache hits/retries. Migration 0007 leaves old rows **null**,
  rather than inventing past acquisition times. Legacy discovery/backfill does not
  set it. Removing ownership removes this timestamp with that row.
- Backend-only `analysis_persisted` mirrors that committed user/hash acquisition,
  with the acquisition timestamp, canonical analysis reference and no properties.
  Single and sequential batch flows share this boundary. Quota, artifact/metadata/
  ownership failure never emits it. Analytics failure cannot change A2's response.
  A unique user/analysis index prevents repeated opens/retries from counting again
  and allows two owners of the same hash to activate independently. Delivery is
  **best effort, not exactly once**. The report falls back to authoritative retained
  ownership plus verified readable artifacts. Deleted history / expired events can
  remove evidence; reacquisition is not guaranteed to establish lifetime novelty.
- `campaign_review_opened`: view kind `compare`, `trends`, or `intelligence`.
  Client sends only base/target hashes, random browser-session UUID and view kind.
  Server-authenticated user/time are not accepted from the body. Server verifies
  ownership, readable artifact projections, unchanged fingerprints, a known same
  campaign, different hashes, strict valid game-date chronology and no known
  version conflict. Unknown version is allowed with the existing semantics; it is
  not evidence of version compatibility. No private campaign ID, country/equipment
  values, filename or local path is added to event properties.
- Compare emits after a usable completed result commits, not while loading,
  showing an error, same-date/reversed/same-hash or different/unknown campaign.
  Trends emits from Plotly initialization/update only when a visible finite series
  contains two chronological observations in a known campaign. Intelligence emits
  after an eligible window displays at least one **supported insight card**; empty
  coverage, unsupported messages, loading/errors/suppression do not count.
- Browser sessionStorage prevents rerender/remount duplicates per UTC day/view/
  endpoints. PostgreSQL independently deduplicates authenticated user/session/
  UTC day/view/endpoints. Different sessions are not different people. Multiple
  sessions can observe the same review; participant conversion counts are unique.
  Failed telemetry is not retried automatically and can be absent.

The new authenticated `/api/product-events/campaign-review` endpoint shares B2's
telemetry IP/global/authenticated-user limits and normal JSON/CSRF/session policy.
It rejects arbitrary fields, client timestamps, identities and foreign references.
Server eligibility does **not** prove someone actually looked at the screen. An
authorized modified client can claim a render. Reviews remain client observations,
not server-trusted proof of comprehension, value or an actual Intelligence rule.

## Operational definitions

All calendar-day calculations use **UTC**, fixed for this study, not browser or
operator timezone. Game chronology uses game dates, never upload timestamps.

| Stage                         | Definition / denominator                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invited                       | Exactly 20 independently verified people recorded by the operator through the established cohort channel. Neither email nor a browser UUID proves independence.                                                                                                                                                                                        |
| Registered                    | Cohort UUID maps to an existing non-admin PostgreSQL user. Operator confirms unmapped `unregistered`; unknown/deleted mapping is unavailable, not an assumed zero. Denominator: 20 invited.                                                                                                                                                            |
| First durable                 | Earliest C1 committed acquisition / backend persistence event after registration and invitation in the study window. Never computation-only. Denominator: invited, with unavailable evidence separately reported.                                                                                                                                      |
| Campaign ready                | Current retained readable owned artifacts contain at least two distinct hashes in a known same campaign, valid different game dates, no known game-version conflict. A same-date duplicate cannot establish chronology; unknown campaigns remain isolated. Count participants with at least one such pair.                                             |
| Historical review             | First eligible observed Compare/Trends/Intelligence render, revalidated against currently retained owned artifacts. Missing/deleted/corrupt endpoints make old observations unverifiable.                                                                                                                                                              |
| Confirmed useful activation   | Durable acquisition + historical review + explicit affirmative usefulness feedback recorded by the operator. A review click alone does not qualify.                                                                                                                                                                                                    |
| Later-day return              | An authenticated product event on a UTC date later than the first verifiable historical review date. This is observed activity, not proof of voluntary return.                                                                                                                                                                                         |
| Meaningful return             | Later-day eligible review of the **same campaign** with a distinct target hash acquired after first review, before that later review, on a strictly later game date than the original target. A previously observed pre-review acquisition of that hash disqualifies it. Same hash, same-date saves and unrelated campaigns do not count.              |
| Independent meaningful return | Meaningful return plus explicit study record confirming that UTC return date was unprompted. Never infer prompting from timestamps.                                                                                                                                                                                                                    |
| D1 / D7 meaningful            | Meaningful return on exactly first-review UTC date +1 / +7. Denominator: reviewed participants with the **entire** respective day elapsed and verified observation coverage. In-progress windows are incomplete even if an early return has occurred; early activity remains visible as meaningful return. Unavailable windows are excluded, not zero. |

Registration-to-durable/review seconds subtract PostgreSQL registration timestamp
from the first respective verified observation. The report presents per-person
pseudonymous rows; percentages must show numerator, eligible denominator and
unavailable/incomplete counts. Campaign-ready counts describe current retained
state, not reconstructed past membership. The tool does not simulate the game.
Registration evidence is bounded by the report's observation end, not accounts
created after it. An unprompted return date must attest the qualifying meaningful
return itself, not merely some unrelated unprompted visit on the same day.

## Cohort setup and read-only report

1. Apply additive migration `0007_alpha_activation.sql` with the established
   reviewed migration process before C1 instrumentation goes live. No data rewrite,
   inferred backfill or destructive migration. Do not change older migrations.
2. Complete B3 contact/verification/privacy gates. Assign a study owner and verify
   event ingestion with isolated fixtures. Start a fresh cohort after instrumentation;
   exclude developer, demonstration and automated accounts explicitly.
3. Maintain an access-controlled private JSON manifest **outside git**. No emails,
   saves, filenames, passwords or tokens. Use pseudonyms `p01` through `p20` and
   verified account UUIDs. Record explicit usefulness feedback and unprompted return
   dates through the prior cohort channel. A participant withdraws/deletes -> remove
   their mapping/feedback according to the reviewed study-record policy; do not
   silently replace them to maintain denominators.

Manifest shape (expand participants to exactly 20 testers; optional explicit
excluded records use roles `developer`, `demo`, `automated`):

```json
{
  "startedAt": "2026-10-10T00:00:00Z",
  "telemetryVerifiedSince": null,
  "participants": [
    {
      "participantId": "p01",
      "role": "tester",
      "invitedAt": "2026-10-10T00:00:00Z",
      "registration": "unknown",
      "userId": null,
      "usefulnessConfirmed": null,
      "unpromptedReturnDates": []
    }
  ]
}
```

Dates above are examples, not an invitation schedule. `registered` requires a real
verified UUID. Set `telemetryVerifiedSince` only after operational verification;
`null` means negative event-based conclusions are unavailable. Do not certify
coverage after an outage or expired observations. Even verified transport remains
best effort. Duplicate participant/UUID mappings or a non-20 tester count fail.

The report rejects a future `--as-of`: do not make incomplete D1/D7 windows appear
complete by supplying an observation end that has not occurred.

Build locally: `npm --prefix server run build`. From `server/`, with deliberately
configured read-only database credentials and read-only artifacts:

```bash
node dist/src/telemetry/alpha-cohort-report.js /private/cohort.json --as-of 2026-10-20T00:00:00Z
```

This example is **not** executed against production by development. Prefer an
isolated consistent database/artifact copy using the existing recovery procedure.
The command uses a repeatable-read **READ ONLY** transaction, SELECT-only queries,
statement timeout, sequential bounded projection cache and artifact fingerprint
revalidation. It never bootstraps AppModule, reconciles Recent, rewrites files,
mutates ownership or runs retention. Large scopes fail rather than truncating
results. No public reporting endpoint/dashboard is added.
The connection wait is bounded to five seconds. Aggregation retains only compact
snapshot identity/date/version, not country/equipment projections. Standard output
is JSON; unavailable artifact counts/statuses replace diagnostic log chatter.

Output includes invitation/registration/durable/readiness/review conversions,
registration latencies, observed review usage by kind, upload rejection and known
persistence-failure counts, later/meaningful returns and D1/D7 eligible/incomplete/
unavailable windows. Single-file temporary completions and batch persistence-stage
failures are counted separately from computation success. Old completion events
without `persistenceOutcome` do not establish a known persistence outcome.
Missing coverage yields null failure counts. No emails, user UUIDs, campaign IDs,
analysis hashes, filenames or game-data values are printed.

If any completion in the window lacks a persistence outcome, the persistence
failure total is unavailable (`null`); `persistenceOutcomesUnknown` reports that
gap rather than quietly turning unknown outcomes into durable successes or zero.
Unmapped accounts or unverified observation coverage also produce unavailable
failure/review-usage totals, not fake zeroes. Durable acquisition remains positive
when authoritative evidence exists despite a missing event mirror; without that
evidence and verified coverage, its absence is unavailable.

Never interpret missing browser observations as proof of no activity. History
removed, account deleted, missing artifacts, incomplete mapping, missing event
mirror, retention expiry and outages can prevent a conclusion. Events do not
capture all page arrivals; first-review anchoring is earliest **verifiable observed**
review, not a guaranteed lifetime first. Review totals are deduplicated observations,
not exact numbers of intentional user actions. `asOf` bounds study events; artifact
readiness describes the currently readable inventory, not a time-travel snapshot.

## Study targets, privacy and lifecycle

Exploratory pilot decision thresholds: **20 independent participants**, at least
**12 confirmed useful activations**, at least **8 confirmed meaningful unprompted
returns**. Compare these with explicit feedback and study prompting records, not
click totals. Small-sample selection, missing evidence and incomplete follow-up
must be shown. These are provisional decision targets, not population benchmarks
and not willingness-to-pay evidence. Collect payment intent separately if approved;
no billing/marketing attribution is introduced here.

Events use the existing first-party PostgreSQL store and B3 account-linked deletion
and operational 90-day raw-event purge. Ownership timestamp lasts only as long as
that ownership; canonical metadata/artifacts retain their existing lifecycle. Event
uniqueness disappears when retention/deletion removes rows; recovery from retained
ownership is idempotent, not a permanent exactly-once journal. No raw IP, browser
fingerprint, save contents, filename, country/equipment data or local paths added.
Support/study manifests and exported reports are separate operator-held records:
human review must set access, retention and withdrawal handling. Do not retain
unnecessary identifiers just to improve metrics. Backup limitations and restore
reapplication remain those in `external-alpha-privacy-support.md`; no R2 changes.
