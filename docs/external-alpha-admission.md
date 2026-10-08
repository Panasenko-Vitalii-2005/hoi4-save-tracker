# External alpha admission and abuse protection (B2)

This is a **single-backend-process**, opt-in boundary for the controlled 20-user
cohort, not a public-beta abuse-prevention system. No database migration, invitation
table, browser fingerprinting or new product telemetry is required. A1 owned
history, A2 explicit persistence outcomes and A3 physical capacity gates still apply.
The [B3 privacy/account lifecycle](external-alpha-privacy-support.md) adds a real
support-mailbox launch gate and verified offline operator procedures. The admission
allowlist is not email ownership verification or account-recovery authority.

## Existing boundaries retained

- Auth uses PostgreSQL accounts/opaque hashed sessions, scrypt passwords,
  HttpOnly/SameSite cookies (Secure in the alpha overlay), expiry/revocation and
  disabled-account checks. Unsafe requests still require the existing CSRF token
  and origin checks. Ownership remains required for private results and mutations.
- Public shares remain opaque, revocable read-only projections; throttling does
  not make a private hash public. Telemetry retains its event/property allowlists,
  authenticated ownership checks and best-effort behavior; no IP is added to it.
- Upload admission remains two in-flight requests, one worker in the alpha
  profile, with independent compressed/decompressed caps (256/512 MiB defaults),
  a 120 s upload deadline, 60 s analysis deadline, bounded gunzip/worker work and
  owned temporary-file cleanup. JSON uses Nest/Express's existing 100 KiB default
  parser limit. No worker concurrency or artifact retention policy was changed.
- Backups, cleanup and the deliberate production Caddyfile override that removes
  Basic Auth are unchanged. No production runtime was inspected in this task.

Confirmed missing safeguards were unrestricted signup and lack of general
application request throttles, not a demonstrated compromise. Capacity exhaustion,
multi-instance evasion and distributed denial of service are separate risks.

## Explicit settings

All four variables are passed to the backend by the base Compose file and inherited
by `docker-compose.private-alpha.yml`. Defaults preserve existing environments.
Invalid boolean/proxy configuration fails startup rather than silently enabling
unrestricted trust. Settings are read at startup; changing them requires backend
recreation, not a frontend build.

| Variable                        | Default | Meaning                                                                                                                  |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `HOI4_REGISTRATION_INVITE_ONLY` | `false` | Set `true` to restrict **new** account registration                                                                      |
| `HOI4_REGISTRATION_ALLOWLIST`   | empty   | Comma-separated authorized emails, trimmed/lowercased, maximum 200 entries; empty controlled list denies all new signups |
| `HOI4_ABUSE_PROTECTION_ENABLED` | `false` | Set `true` to enable all policies below                                                                                  |
| `HOI4_TRUSTED_PROXY_CIDRS`      | empty   | Explicit trusted proxy IPs/CIDRs, maximum 32; no hop count, named private range, `true`, or `/0` blanket trust           |

The allowlist is **admission, not proof of email possession**. There is no email
verification or invite token in this phase. An attacker who knows an authorized
address could attempt to register it first. Coordinate admission privately,
authorize near onboarding, confirm the tester's account, then remove that address
from the list. Existing accounts/sessions/login remain valid after removal. No
admin privilege is granted. Do not publish the list, print full environment/config,
or store real identities in git. Verification/recovery is a B3 concern.

## Exact throttle policies

Fixed windows start at the first admitted attempt, not wall-clock boundaries. Both
valid and invalid attempts count. IP/global checks run before JSON parsing, session
validation, CSRF, password work and upload interceptors. Account/user checks run
after the existing session/CSRF guard and before controllers/interceptors.

| Operation                                           | IP allowance | Process-wide allowance | Normalized account / authenticated user allowance |
| --------------------------------------------------- | ------------ | ---------------------- | ------------------------------------------------- |
| Registration                                        | 40/hour      | 100/hour               | 5/email/hour                                      |
| Login                                               | 120/15 min   | 600/15 min             | 10/email/15 min                                   |
| Public share GET/HEAD, including invalid IDs        | 60/min       | 300/min                | none                                              |
| Client telemetry POST                               | 600/min      | 2,000/min              | 120/user/min                                      |
| Analyze POST (single, sequential batch, local JSON) | 600/hour     | 1,000/hour             | 120/user/hour                                     |
| Batch preflight POST                                | 120/min      | 600/min                | 30/user/min                                       |
| CSRF bootstrap / session GET/HEAD, logout POST      | 600/min      | 5,000/min              | none                                              |

These constants live in `server/src/security/abuse-protection.service.ts`; they are
not arbitrary per-request environment overrides. Revisit through a reviewed change
if real cohort feedback requires it. Twenty users with 25 uploads each fit the
500-upload shared-NAT exercise, and a single user can choose All for 100 snapshots.
Retries count too; larger sessions can wait for the indicated window. Worker busy
responses remain the existing 503 policy; there is no automatic request replay.

429 responses have `code=RATE_LIMITED`, bounded `retryAfterSeconds`, `Retry-After`
seconds and `Cache-Control: no-store`. EN/RU login, upload/batch and public-share
views explain waiting and manual retry; telemetry is best-effort and not retried.
Registration denial is 403 `REGISTRATION_NOT_INVITED`, distinct from `CSRF_INVALID`.
Rejected requests perform no artifact, ownership or telemetry writes. Bytes already
sent by a browser/proxy are not magically unsent by a server-side early rejection.

## Client identity and proxy trust

Supported repository paths:

1. Private alpha: Internet -> Caddy edge -> backend:3001 directly for `/api/*`.
   The SPA alone goes through frontend nginx. The documented removal of Caddy Basic
   Auth does **not** change this API proxy topology.
2. Local Compose: browser -> frontend nginx -> backend:3001.

Backend has no published host port in either repository configuration. Trust only
the controlled application-network CIDR or exact proxy addresses actually observed
by the backend. Do not trust database networks, all RFC1918 space, arbitrary hop
counts, user IPs, or unreviewed alternative ingress. A network CIDR implicitly trusts
every member: keep membership limited to controlled application containers and
review any additional overrides. Do not expose backend:3001 publicly.

[Express's IP/CIDR trust model](https://expressjs.com/en/guide/behind-proxies/)
walks from the socket through forwarded addresses right-to-left, stopping at the
first untrusted hop. The limiter uses only this `req.ip`, never a raw first XFF
value. [Caddy defaults](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
ignore incoming forwarded values to prevent spoofing. Repository nginx appends its
socket peer to XFF; the same right-to-left boundary rejects a spoofed leftmost IP.
An extra CDN/proxy is **not** automatically supported: review sanitization and trust
at each hop first. Trust also affects Express protocol/hostname; preserve exact
`HOI4_HTTPS_ORIGIN` and existing CSRF tests when reviewing topology.

Empty trust ignores forwarded headers and groups requests at the proxy/socket
address: safe against spoofing, but potentially restrictive. Missing/invalid
resolved IP fails into one shared bucket rather than bypassing limits. Shared NAT
users still have independent account/user budgets under the larger IP ceiling.
Limits are not a claim that every client has a unique IP. IPv6 address rotation is
bounded by account and global ceilings, not fingerprinting.

## Limiter storage and operational limits

Only process-local random-key HMAC identifiers and counts/expiry are stored; no raw
IP/email/user ID or password/token/save bytes are retained by the limiter or logged.
At most 10,000 buckets exist. Windows expire in at most one hour; a 30 s unref'ed
sweep removes expired entries. When full, new identities fail closed with a 30 s
retry hint; live buckets are not evicted to permit identity-rotation bypass. Buckets
and the secret disappear at shutdown; restart clears limits. No limiter DB writes.
Inspect HTTP status/code/Retry-After for troubleshooting, not identities. Existing
proxy logging remains an independently reviewed operator retention concern.

This is not distributed/shared limiter storage: multiple replicas multiply the
allowance. A distributed attacker can consume a global budget or lock out a known
email temporarily; an abusive shared NAT can affect its peers. This intentionally
does not solve volumetric attacks, upstream buffering/connection exhaustion,
account recovery/deletion, email possession verification, or per-user storage
entitlements. Keep one backend replica and the A3 capacity gate for this cohort.

## Operator enablement gate (instructions, not executed)

1. Preserve current project options, ordered Compose overrides, private env file,
   volumes and deliberate Caddy override. Confirm exact deployed source/image;
   checkout configuration alone is not evidence of runtime settings. Complete A3
   capacity checks first. Do not run a blind reset or replace the Caddyfile.
2. On the operator host, using the existing Compose invocation (add all actual
   overrides), inspect only controlled network information:

   ```bash
   cd /path/to/approved/checkout
   docker compose --env-file .env.private-alpha -f docker-compose.yml -f docker-compose.private-alpha.yml ps
   docker inspect --format '{{range .NetworkSettings.Networks}}{{.NetworkID}} {{.IPAddress}}{{println}}{{end}}' "$(docker compose --env-file .env.private-alpha -f docker-compose.yml -f docker-compose.private-alpha.yml ps -q backend)"
   # Inspect the identified application network, not an invented subnet:
   docker network inspect --format '{{range .IPAM.Config}}{{.Subnet}}{{println}}{{end}}' "APPLICATION_NETWORK_ID_FROM_PREVIOUS_COMMAND"
   git diff -- deploy/private-alpha/Caddyfile
   ```

3. Privately edit the operator env file: set invite-only and abuse protection to
   `true`, enter the privately coordinated tester emails, and set the observed
   narrow controlled proxy CIDR/IPs. Do not copy fixture addresses/credentials or
   print full `docker compose config`. Empty invite-only list is a valid closed
   registration gate. Empty proxy trust is not suitable for distinct edge clients.
4. Run config-only validation locally (`node server/scripts/verify-capacity-compose.cjs`)
   with its **synthetic** fixture. It checks all 17 capacity/security settings in
   local/alpha default/override combinations without a daemon or real env contents.
   After approval, use the existing approved deployment procedure to build/recreate
   **backend only**, preserving volumes/overrides and Caddy. This task performs none
   of those remote actions.
5. Verify inside the running backend, outputting booleans/counts only:

   ```bash
   docker compose --env-file .env.private-alpha -f docker-compose.yml -f docker-compose.private-alpha.yml exec -T backend node -e 'const e=process.env; console.log({inviteOnly:e.HOI4_REGISTRATION_INVITE_ONLY,abuse:e.HOI4_ABUSE_PROTECTION_ENABLED,allowlistEntries:(e.HOI4_REGISTRATION_ALLOWLIST||"").split(",").filter(x=>x.trim()).length,proxyConfigured:!!(e.HOI4_TRUSTED_PROXY_CIDRS||"").trim()})'
   ```

6. Controlled acceptance: existing login/session, an invited signup and denied
   uninvited signup; CSRF rejection; private ownership and revoked/invalid share;
   one 25-save sequential import; distinct clients through the actual edge. Use an
   isolated staging fixture for flood/429/expiry/spoofed-XFF tests, **not** production
   stress. Confirm Retry-After and EN/RU recovery without retry loops. Check readiness
   and capacity as in existing runbooks. Do not infer proxy correctness merely from
   two successful requests below the limit.
7. For rollout issues, preserve all data and diagnose response code/headers first.
   Keep invite-only enabled; review the proxy boundary/limits. A local restart
   clears buckets but is not a routine bypass/recovery scheme. Reverting B2 settings
   is an explicit security decision, not automatic fallback.

### B3, not B2

Account/email verification and recovery/deletion operations, consent/privacy and
proxy log retention review, independent activation/return measurement and support
processes remain separate. This code does not establish legal/licensing readiness
or customer demand, and makes no legal claim about Paradox.
