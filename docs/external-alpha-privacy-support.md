# External alpha privacy and account lifecycle (B3)

Scope: the controlled ~20-person cohort, one backend writer. No email-verification
service, password-reset delivery, public account-admin API, data transfer, new
retention architecture or physical-erasure guarantee is introduced. No migration.
This describes repository behavior, not an inspection of production configuration
or a legal-compliance conclusion. A1 durable history, A2 persistence outcomes,
[A3 capacity](external-alpha-capacity.md) and [B2 admission](external-alpha-admission.md)
remain required.

## Verified lifecycle

| Data            | Storage / boundary                                                                                                                            | Removal and residuals                                                                                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account         | PostgreSQL `users`: email, scrypt password hash, UUID, timestamps, disabled/admin/verification flags                                          | Verified operator deletion removes row; allowlisting never verifies email ownership.                                                                                                                                                                                                                   |
| Sessions        | PostgreSQL `sessions`: opaque token **hash**, expiry; browser HttpOnly cookie, separate CSRF cookie                                           | Logout revokes its token. Operator revokes all target sessions; disable blocks existing sessions and future login. Existing repository does not populate optional IP/user-agent columns. An already-running request is not retroactively undone.                                                       |
| Original upload | `SaveUploadInterceptor` owned temporary `.hoi4`; gzip normalization also temporary                                                            | Cleanup awaited on completion/rejection/failure/disconnect after worker lifetime. Crash/failed cleanup can leave files for bounded stale-file startup cleanup; no promise of instantaneous physical erasure. Local-save mode, when explicitly enabled, reads operator files rather than deleting them. |
| Computed result | Memory/cache and compressed hash-deduplicated artifact                                                                                        | A2 explicitly reports temporary-only persistence failure. Only durable owned results are saved-history capabilities. User deletion does not unlink artifacts; existing global retention remains unchanged.                                                                                             |
| Owned history   | PostgreSQL `analysis_ownership`, private filename/pin/history metadata; canonical `analyses` metadata                                         | Removal deletes only target ownership. A1 keeps retained owned artifacts discoverable independently of global Recent turnover. Co-owner ownership/pins are untouched.                                                                                                                                  |
| Global metadata | `recent-analyses.json` (default 200 entries); PostgreSQL canonical `analyses` rows                                                            | May retain filenames/derived summaries/references after personal/account deletion. Neither is a per-user erasure index. No blanket cleanup is run by the support tool.                                                                                                                                 |
| Public share    | `shared-analyses.json`, format 1, one opaque URL per hash; full derived result                                                                | Deliberate creation; anyone with URL can read custom game text. Private filename/original save/account credentials are not shared. Current owners can revoke. Deletion now revokes current global link before ownership removal. Previously downloaded copies cannot be recalled.                      |
| Telemetry       | First-party allowlisted `product_events`: action/outcome, nullable account/session/analysis IDs, random browser-session UUID, safe properties | No save content, filename, email, IP, fingerprint or token as analytics properties. Account deletion removes **account-linked** rows, not anonymous opens/other owners' events. Separate operational logs may have different retention.                                                                |
| Browser data    | Theme/language in localStorage; random product-session UUID and event-dedup markers in sessionStorage                                         | Not credentials; no remote browser-storage deletion. Closing browser session clears sessionStorage according to browser behavior.                                                                                                                                                                      |
| Local backups   | PostgreSQL dump + checksum; analysis-history archive + checksum                                                                               | Both scripts default to **7 successful generations**, not seven days; review actual private settings/timers. Generation rotation is existing behavior, not individual-record erasure.                                                                                                                  |
| R2 backups      | Existing append-only replication of validated complete generations                                                                            | No R2 delete/sync/purge, per-record erasure or automated off-site expiry added. Historical accounts, links, filenames and campaigns can remain until a separately approved backup policy removes generations.                                                                                          |

References: `server/src/auth/`, `server/migrations/0001_users_sessions.sql`,
`0002_analysis_ownership.sql` through `0006_owned_analysis_history.sql`,
`server/src/analyze/{save-upload.interceptor,persisted-analysis-result.service,
user-analyses.service,shared-analyses.service}.ts`, `server/src/telemetry/`,
`deploy/private-alpha/{backup-postgres,backup-analysis-history,replicate-backups-offsite}.sh`.

## Public-link policy, including legacy co-owners

Previously, deleting private ownership left a global link live but removed the
authorization needed to revoke it. The store has **no creator/owner attribution**;
inventing one for existing URLs would be unsafe.

Conservative policy: deleting any currently owned analysis (single, campaign,
unpinned or all history) revokes that hash's current public link **globally first**,
then removes only the requesting user's ownership. Other owners keep private
access and physical artifacts. They can explicitly share again under a **new** URL;
the revoked URL stays revoked. Direct revocation also only removes the token,
not an artifact. EN/RU confirmations explain this global effect.

Share creation rechecks ownership inside the same serialized queue as removal;
queued creation by a departing owner cannot recreate a link after deletion.
Revocation-write failure preserves ownership and reports failure. A subsequent
database failure can leave the link revoked with ownership intact (safe to retry).
Unreliable/corrupt share storage blocks mutations rather than overwriting unknown
links. Valid legacy URLs stay unchanged until explicit revocation/deletion.

Old orphan links whose owners already deleted history cannot be attributed from
format-1 metadata. A **verified operator case**, not email or URL possession alone,
may use `revoke-link` with the existing opaque ID. It affects everyone using that
link and never unlinks the result. Resolve uncertain attribution conservatively
with the legitimate cohort participant; do not hand out private content or transfer
ownership. A co-owner may subsequently publish a new link. Revocation cannot stop
that independent authorized choice or erase copies already obtained.

## Real support mailbox — launch gate

The operator must create/select a dedicated mailbox under their control, restrict
its access, and verify incoming/reply delivery. **No mailbox is selected by this
change. Missing working contact is an external-alpha launch blocker.**

1. Privately edit `.env.private-alpha` and set `HOI4_SUPPORT_EMAIL` to that real
   plain address (no display name, URL, newline, query or mail headers). Do not
   paste the private environment file into tickets/logs. It is intentionally public
   contact configuration, unlike credentials/allowlist.
2. Base `docker-compose.yml` passes it to backend; the private-alpha overlay
   inherits it. Recreate backend with the approved deployment procedure when this
   change is released. No frontend rebuild is needed for subsequent contact edits.
3. Open the public **Privacy & alpha support** disclosure before login and on a
   public share, in EN and RU. Expand it: `GET /api/privacy` (no-store) must expose
   only `supportEmail`; the mailto must open the real mailbox. Invalid/missing
   configuration or request failure shows localized **Support currently unavailable**,
   no invented address. A syntactically valid address is not proof it receives mail.
4. Send a test help request and receive a reply before inviting users. Cover access
   help, account/data deletion, privacy questions and general alpha support.

No ticketing system, automatic delivery or password-reset email is implied.

## Identity verification and lost access

B2 opt-in abuse protection additionally uses bounded, short-lived HMAC identifiers
for network/account buckets in process memory, not product-event IP properties.
Restart resets those buckets; operational access logs need a separate reviewed
retention policy. Support does not collect saves or add new telemetry events.

Before inviting each tester, establish a trusted independent cohort contact channel
and a minimal operator-side mapping to the registered account UUID. Obtain the UUID
through the participant's authenticated `/api/auth/me` response/verified onboarding,
not a claim of knowing an email. Keep that mapping private; a submitted UUID is also
not proof. Current authenticated account control plus the previously established
channel is the preferred evidence. If access was lost, verify through that prior
channel and cohort record; a message from an arbitrary new sender is insufficient.

Never request passwords, session cookies/tokens, reset credentials or complete saves.
An allowlisted email is admission only. There is **no** automated email ownership
verification or password reset. If proof is insufficient, do not disable/delete the
claimed victim, reset a password or transfer data. Escalate and explain the limitation.
For a verified lost-access request where safe recovery is unavailable, disable the
old account and revoke sessions; authorize registration of a new **empty** account
through a verified new cohort address. No old ownership is transferred. Do not
re-enable the old account without a separately reviewed secure credential process.

## Offline operator commands

`server/src/operations/alpha-support.ts` is **not** registered as an HTTP service.
Only a trusted operator with database/volume access can run it. Its confirmation
flags are guardrails, not identity verification. It refuses email selectors,
administrator mutation, missing/mismatched UUID confirmation and unsupported reset
or transfer operations. Preview emits counts/status, not emails, hashes or tokens.

Build with `npm --prefix server run build`. Local execution from `server/` uses
`node dist/src/operations/alpha-support.js` and deliberately configured test/local
environment. Never load production environment for tests.

For an approved future production support operation, use the deployed backend image
and its existing private environment/volume. Declare a short maintenance window;
**stop every backend writer first**. The JSON share registry is not multi-process
safe. Do not run a second normal application instance or start the Nest AppModule
for maintenance (startup reconciliation can run ordinary retention). Keep PostgreSQL
running. Review A1/A2 and health checks after maintenance; preserve the deliberate
Caddy override. These are instructions, not commands executed by B3 development.

```bash
set -euo pipefail
# Copy only the VERIFIED target UUID and a non-sensitive private case identifier.
ACCOUNT_ID='<VERIFIED_ACCOUNT_UUID>'
CASE_ID='<VERIFIED_CASE_ID>'
[[ "$ACCOUNT_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || exit 1
[[ "$CASE_ID" =~ ^[A-Za-z0-9_-]{3,80}$ ]] || exit 1
compose=(docker compose --env-file .env.private-alpha -f docker-compose.yml -f docker-compose.private-alpha.yml)
"${compose[@]}" stop backend
"${compose[@]}" run --rm --no-deps -T backend node dist/src/operations/alpha-support.js preview "$ACCOUNT_ID"
# Choose exactly the VERIFIED request: revoke-sessions, disable, or delete-account.
ACTION='disable'
[[ "$ACTION" == 'revoke-sessions' || "$ACTION" == 'disable' || "$ACTION" == 'delete-account' ]] || exit 1
"${compose[@]}" run --rm --no-deps -T backend node dist/src/operations/alpha-support.js "$ACTION" "$ACCOUNT_ID" \
  --apply --offline-confirmed --confirm-user "$ACCOUNT_ID" --verified-case "$CASE_ID"
"${compose[@]}" run --rm --no-deps -T backend node dist/src/operations/alpha-support.js preview "$ACCOUNT_ID"
"${compose[@]}" start backend
```

Remove the former admission address from the private allowlist before verified
account deletion to avoid unintended re-registration, following B2 restart rules.
Deletion first disables the account and revokes sessions in a transaction, then
revokes its owned global links, then transactionally deletes account-linked events
and the user (sessions/ownership cascade). If link writing fails, account remains
disabled with ownership/events retained; repair the store and preview/retry. If DB
deletion fails, account data rolls back but successfully revoked links remain
revoked. Non-zero exit means **not completed**; do not restart automatically on error.

No original files, compressed artifacts, global Recent, canonical analysis rows,
anonymous events, other owners or backups are deleted by this command. Pins in
global Recent can remain conservative residual protection; another owner's pin
is never removed. Physical residuals require separate reviewed handling, not a
bulk hash purge. Deletion output explicitly says artifacts/backups were not erased.

For a verified legacy orphan, use the same offline window and `revoke-link
<OPAQUE_SHARE_ID> --apply --offline-confirmed --verified-case <CASE_ID>` instead
of an account command. This is never a public endpoint. Record the global effect.

Before account deletion, review previously shared URLs with the verified participant
and revoke any verified legacy orphans separately. Preview counts only links for
currently owned hashes; format 1 cannot identify all historic creators. Do not claim
that account deletion alone automatically discovers/revokes unattributable old links.

Keep a private minimal completion register: case ID, verified account/link scope,
verified channel/evidence reference, approval, timestamp, counts, success/failure,
remaining limitations, and restoration instructions. No password, token, full save,
backup credentials or public dump of participant identities. Access-control and
retention for this operator register/logs need human review.

## Telemetry retention and restoration

Raw events target **90 days**, operationally enforced, **not scheduled in-app**.
Assign a named operator and a daily maintenance check before invitations. In an
offline/exclusive window as above, run:

```bash
set -euo pipefail
compose=(docker compose --env-file .env.private-alpha -f docker-compose.yml -f docker-compose.private-alpha.yml)
"${compose[@]}" stop backend
"${compose[@]}" run --rm --no-deps -T backend node dist/src/operations/alpha-support.js purge-telemetry --apply --offline-confirmed
# Inspect returned removed/backlogRemaining. Repeat bounded command if backlog remains.
"${compose[@]}" start backend
```

One invocation uses a fixed database-time cutoff, at most 20 transactions of 1,000
rows, a 10 s statement timeout and strict `occurred_at < cutoff`. Exact cutoff and
recent rows survive. Only `product_events` is touched; canonical `analyses` and
artifacts are not purged. Counts and backlog must be recorded; failed/missed checks
mean the target is not being met. There is no promise of a hard 90-day maximum,
automatic alerts, VACUUM-based physical wipe or deletion from backups. Small-cohort
tables use existing indexes; selection may scan old events, not constant-time.

Before any restored database/history is made reachable, consult the completion
register and **reapply** verified disables/session revocations/account removals,
global link revocations (including revoked IDs recreated by old backups), and the
event-retention purge on the restored state. Validate new URLs/private ownership
and ensure all restored sessions from affected accounts are gone. Keep the restored
service isolated until this is complete. Do not mutate R2 or restore over live
volumes during a drill; use the existing operations runbook.

## Pre-invitation acceptance and remaining limitations

- Working support mailbox configured, EN/RU public disclosure and mail delivery
  manually tested; named support and daily-retention operator, verified cohort/UUID
  mapping and minimal deletion/restoration register in place.
- Isolated rehearsal: all target sessions fail after revoke; disable blocks login;
  deletion revokes links before removing ownership; co-owner can reopen privately;
  a new share gets a new URL; corrupt store fails safe; retention backlog cleared.
- A1/A2 history/durable-result boundaries, A3 measured disk/capacity and B2
  invitation/proxy/rate-limit gates checked. No full erasure or legal compliance
  claims; human review of jurisdiction, consent/privacy wording, logs, mailbox and
  backup/operator-register retention is still required.
- No secure self-service recovery; no creator attribution for legacy global links;
  no per-owner public link policy; no automatic scheduler/off-site expiry. Account
  deletion means the documented access/identity/reference removal, not physical
  erasure. No production access or backup modification is part of implementation.
