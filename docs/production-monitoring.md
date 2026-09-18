# Private Alpha production monitoring and failure alerting

## Decision

Use a deliberately small three-layer design:

1. one hosted provider runs an external HTTPS readiness check and receives
   independent dead-man heartbeats;
2. each backup unit reports successful completion and uses a systemd
   `OnFailure=` notifier for immediate failure reporting;
3. one VPS-side systemd timer checks Docker/service state, backup freshness,
   timer state, disk/inodes, and memory, then reports to its own external
   heartbeat.

For the current one-VPS, one-operator Private Alpha, **Better Stack Uptime** is
the preferred hosted provider because its public documentation supports both
[external HTTP status monitoring](https://betterstack.com/docs/uptime/monitoring-start/)
and [cron/heartbeat monitors](https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/)
under one incident/notification system. Provider plan limits and current price
must be checked when Phase 1 is configured; this design does not depend on a
permanent free tier.

The same architecture can instead use Healthchecks.io for dead-man checks plus
UptimeRobot for HTTPS uptime. Healthchecks.io explicitly supports systemd
`OnCalendar` schedules, grace periods, start/failure signals, and multiple
notification integrations. Two providers give some vendor diversity but add a
second account and incident surface. Self-hosting either tool on the monitored
VPS would not detect loss of that VPS and is not recommended.

This document began as the Phase 0 architecture. Phase 1A readiness, Phase 1B
backup heartbeat/failure signaling, and Phase 1C host monitoring have passed
production acceptance. Phase 1D operational procedures and the non-destructive
recovery drill are maintained in the
[Private Alpha operations runbook](private-alpha-operations-runbook.md).

## 1. Current observability

### 1.1 Application and Docker

The production profile is `docker-compose.yml` plus
`docker-compose.private-alpha.yml`:

| Service | Existing check/start dependency | Restart/log behavior |
| --- | --- | --- |
| PostgreSQL 17 | `pg_isready` every 5 seconds, 5-second timeout, 12 retries, 5-second start period | `unless-stopped`; Docker `json-file`, 10 MiB × 3 files |
| Migration | Starts only after PostgreSQL is healthy; must complete before backend starts | one-shot, no restart; same bounded Docker logging |
| NestJS backend | Container check calls `http://127.0.0.1:3001/api/health` every 10 seconds; endpoint executes a bounded, coalesced `SELECT 1` and returns 503 when PostgreSQL is unavailable | `unless-stopped`; same bounded Docker logging |
| nginx frontend | `wget` against its local `/` every 10 seconds | `unless-stopped`; same bounded Docker logging |
| Caddy edge | Starts after frontend is healthy; no Docker healthcheck | `unless-stopped`; same bounded Docker logging |

The Docker checks are valuable local state, but they do not notify anyone.
`restart: unless-stopped` restarts a container after its process exits; a
healthcheck becoming `unhealthy` does not by itself restart a still-running
container. Compose `depends_on` is startup ordering, not continuous dependency
supervision.

No CPU, memory, PID, or Compose deploy resource limits are currently set. The
deployment guide recommends at least 2 vCPU, 4 GiB RAM, and 20–40 GiB SSD; one
analysis Worker has a roughly 1 GiB V8 old-generation limit. Host and native
process memory are not bounded by that Worker limit.

Caddy is the sole public listener on ports 80/443. It terminates TLS, sends
`/api/*` to the backend and other requests to the frontend. Backend and
PostgreSQL have no host ports. The repository Caddy profile supports a Private
Alpha HTTP Basic Auth gate with exact `/api/readiness` exception. The current
production VPS deliberately carries a local Caddyfile override with that outer
gate removed; application authentication/session/ownership controls remain.
Nest's session guard explicitly marks readiness public, and no backend port is
published. Preserve and manually review the production Caddyfile override as
documented in the operator runbook.

Application logs go to stdout/stderr and the bounded Docker JSON driver.
NestJS uses its normal logger where services explicitly log; Caddy has no
repository-configured access log. Backup units write to journald. Journald
retention is host policy and is not set by this repository.

### 1.2 Backup jobs

Three root-owned systemd oneshot services exist:

| Job | Timer | Existing success boundary |
| --- | --- | --- |
| PostgreSQL | daily 02:30 server-local | non-empty custom-format `pg_dump`, `pg_restore --list`, finalized data file, SHA-256 sidecar |
| Analysis history | daily 02:40 server-local | backend stopped only when initially running, archive finalized, safe extraction, metadata/result JSON validation, backend restart attempted, SHA-256 sidecar |
| Off-site replication | daily 03:00 server-local | every retained complete local pair revalidated, missing R2 data uploaded first, remote data downloaded and hashed, checksum uploaded last and downloaded/compared |

All timers use `Persistent=true`, so systemd runs a missed event after a reboot.
The scripts use strict shell mode, private temporary files/directories, locks,
atomic same-filesystem finalization, and non-zero exits on failure. PostgreSQL
and history retention keep seven complete local generations by default.
Off-site storage is intentionally append-only.

The backup services use `User=root`, `UMask=0077`, `NoNewPrivileges=true`, low
I/O priority, and root-readable environment files. Phase 1B adds an independent
success heartbeat for each job, atomic local last-success state, allowlisted
`OnFailure=` signaling, and conservative systemd execution ceilings. The
external dead-man remains authoritative for a disabled timer or dead VPS,
because neither systemd nor a local notifier can report when it never runs.

### 1.3 Disk-failure behavior

PostgreSQL and analysis-history backups create temporary output inside their
destination filesystem. A write, validation, checksum, or rename failure exits
non-zero, and traps remove incomplete temporary/final pairs. The history trap
also attempts to restore the backend's prior running state. Replication uses a
private verification directory and does not delete local backups.

This is good failure containment, but there is no free-space preflight. An
`ENOSPC` event is expected to surface as a failed unit and journal entry after
work has already started. Monitoring must warn before that point.

## 2. Monitoring requirements

### Must alert

- public TLS/edge/backend/PostgreSQL readiness is unavailable;
- a required container is stopped, unhealthy, or repeatedly restarting;
- Docker is unavailable;
- any of the three backup/replication services exits non-zero;
- an expected backup/replication success does not arrive;
- a timer is disabled/inactive or its last-success state becomes stale;
- relevant filesystem bytes or inodes approach exhaustion;
- sustained memory pressure or a recent OOM event threatens analysis;
- the local monitoring job itself stops checking in.

### Useful but bounded

- recovery notifications after a real incident;
- TLS expiry as supplied by the hosted HTTPS monitor;
- a small restart-count delta indicating a crash loop;
- journal/runbook pointers in alerts, without attaching logs.

### Intentionally not inferred from current logs

Current application logs do not provide stable, structured counters for auth
failures, HTTP 5xx rates, latency distributions, or user-facing analysis error
classes. Grepping free-form logs would be noisy and brittle. Those signals are
deferred until the application deliberately emits privacy-safe metrics.

## 3. Failure model

### 3.1 Immediate failures

An immediate failure has an event now: a unit exits non-zero, a container stops
or turns unhealthy, or an external request fails. Detection should not wait for
the next day's missed-job deadline.

Use external HTTPS polling, systemd `OnFailure=`, and the five-minute local
health check. Docker health state alone is not an alert.

### 3.2 Silent and staleness failures

A disabled timer, dead scheduler, broken monitoring script, powered-off VPS, or
job that never starts produces no local failure event. Each periodic activity
therefore needs an external expectation. A success heartbeat is sent only after
the complete validated operation. If it never arrives, the hosted provider
opens an incident after the configured grace window.

An `OnFailure=` handler is supplementary, not sufficient. The dead-man monitor
is the authoritative answer to “did this successful operation happen on time?”

## 4. Options evaluated

| Approach | Immediate failure | Silent/VPS failure | Complexity and privacy | Decision |
| --- | --- | --- | --- | --- |
| systemd `OnFailure=` only | Fast for a unit that actually fails | Cannot detect disabled timer, scheduler loss, network partition, or dead VPS | Very small; payload can be tightly bounded | Use as a secondary fast path |
| External dead-man heartbeat | Explicit failure can be signaled; otherwise waits for grace | Detects missed jobs, disabled timer, dead host, or lost egress | Secret ping URL leaves VPS; no save data needed | Required |
| External HTTPS uptime probe | Detects public path/TLS/backend/database failure from outside | Detects host/network loss | Provider sees URL, response code and timing only | Required |
| VPS-side health timer | Detects Docker, disk, inodes, memory, timer state and stale local success | Cannot alert if host/network and checker both disappear unless it has its own dead-man | One small fixed shell program; no agent daemon | Required |
| Better Stack hosted uptime | HTTP monitor and heartbeat in one incident system; email/push/call options documented | External | One vendor/account; current plan limits must be reviewed | Preferred for Phase 1 |
| Healthchecks.io + UptimeRobot | Excellent systemd/cron semantics plus a focused uptime probe; Healthchecks.io supports Telegram and other integrations | External and provider-diverse | Two accounts/configurations and two incident UIs | Valid low-cost alternative |
| Self-hosted Uptime Kuma/Healthchecks | Capable if placed on a second independent host | Same-VPS deployment is circular | A second host, upgrades, backup and alert delivery become new operations | Defer/reject for Private Alpha |
| Prometheus + Alertmanager + Grafana + Loki | Comprehensive metrics/logs | Needs independent alert path and durable monitoring infrastructure | Disproportionate for one VPS and a few users | Explicitly deferred |

The hosted provider is a dependency, not part of the application data path. A
provider outage must never block a backup or application request. Ping failures
are logged locally and eventually appear as a missed-heartbeat incident if the
provider recovers; they do not change a successfully created backup into an
invalid backup.

## 5. Recommended architecture

```text
                 hosted monitoring provider
                /          |               \
       HTTPS readiness   job heartbeats   host-check heartbeat
              |             ^                    ^
              v             |                    |
   Caddy -> backend -> DB    |          systemd health timer
                             |           /     |      |    \
                PostgreSQL backup    Docker  disk   memory timers/age
                history backup
                R2 replication
                   |       |
              success   OnFailure
```

Create five hosted checks:

1. external HTTPS application readiness;
2. PostgreSQL-backup daily heartbeat;
3. analysis-history-backup daily heartbeat;
4. off-site-replication daily heartbeat;
5. local host-health heartbeat every five minutes.

The provider owns incident deduplication and recovery notifications. The VPS
contains only fixed scripts/systemd units and secret URLs. There is no metrics
database, log shipper, node exporter, long-running monitoring container, or
application dependency on the provider.

## 6. Backup monitoring

### 6.1 Success definition

Each script invokes the shared helper only after its ordinary work has reached
the truthful success boundary. For each job that means:

- PostgreSQL: dump is non-empty, `pg_restore --list` passed, the finalized
  data/checksum pair exists, and retention completed;
- analysis history: archive structure and every JSON/gzip result passed the
  isolated validation, the finalized pair exists, and the backend restart path
  did not fail;
- off-site: every eligible retained local generation passed local checksum and
  download-after-upload remote verification, including checksum sidecars.

Do not ping after merely starting a service, creating a file, or seeing a unit
become `inactive`. A successful oneshot unit is normally inactive after it
finishes, so “inactive” is not failure evidence.

`monitoring-heartbeat.sh` is the only component that handles provider URLs. A
success invocation:

1. atomically update a root-owned timestamp/state file under
   `/var/lib/hoi4-save-tracker-monitor/`;
2. selects the job's independent URL from an allowlisted mapping and accepts
   only the official Better Stack HTTPS heartbeat origin/path;
3. sends one request with a two-second connect timeout and five-second total
   timeout, no redirects, no request/output body, and no URL in logs;
4. returns a delivery failure to the calling script, which logs a sanitized
   warning while preserving the already established backup success.

Missing heartbeat configuration is an explicit safe no-op: local success state
is still recorded and the backup stays successful. An invalid URL, unavailable
curl, state-write failure, timeout, or provider error is monitoring failure,
not backup failure. `curl` output is discarded so a capability URL cannot enter
the journal.

Each monitored unit selects one fixed alphanumeric notifier instance:
`postgres`, `analysishistory`, `offsite`, or `hosthealth`. The template passes
the escaped instance unchanged with `%i`, and the helper maps only those exact
keys (plus its direct success subjects) to the four allowlisted jobs. This
avoids ambiguous `%I` path unescaping, where a literal hyphen represents `/`,
without accepting arbitrary unit names. The helper appends Better Stack's
documented `/fail` suffix and never sends journal output or an exit-code
payload. This provides immediate notification when a monitored unit actually
starts and fails. The dead-man deadline remains the fallback if that request,
the timer, network, or entire VPS is unavailable.

`TimeoutStartSec=` is 30 minutes for PostgreSQL, 60 minutes for analysis
history, and 120 minutes for R2 replication. These are conservative safety
ceilings, not performance targets. A timeout becomes a failed unit and invokes
the immediate failure handler.

The resulting semantics are deliberate:

- backup failure: no success heartbeat; `/fail` is attempted; the dead-man
  monitor eventually alerts even if immediate delivery fails;
- backup and heartbeat success: local state and the external deadline advance;
- backup success but provider/network failure: backup remains successful, a
  sanitized warning is journaled, and the external monitor may become late;
- disabled/missed timer: nothing locally can ping, so the dead-man alerts;
- unavailable VPS: all three heartbeats go late while external application
  readiness also fails, separating host-wide loss from one failed job.

### 6.2 Better Stack heartbeat setup

Create three independent heartbeat monitors manually. Do not use one shared
URL and do not commit the generated capability URLs:

| Better Stack heartbeat | Environment variable | Period | Grace | Approximate missed-success alert |
| --- | --- | ---: | ---: | --- |
| Private Alpha PostgreSQL backup | `HOI4_MONITOR_POSTGRES_HEARTBEAT_URL` | 24 hours | 90 minutes | around 04:00 after the expected 02:30 run |
| Private Alpha analysis-history backup | `HOI4_MONITOR_ANALYSIS_HISTORY_HEARTBEAT_URL` | 24 hours | 120 minutes | around 04:40 after the expected 02:40 run |
| Private Alpha off-site replication | `HOI4_MONITOR_OFFSITE_HEARTBEAT_URL` | 24 hours | 180 minutes | around 06:00 after the expected 03:00 run |

Better Stack starts the interval after the first success request. Create all
three monitors, copy each generated base URL to its exact variable in
`/etc/hoi4-save-tracker/monitoring.env`, keep that file `root:root` mode `0600`,
then run each real service once successfully to initialize its monitor. Enable
email and mobile push/recovery notifications consistently with readiness. Do
not configure a generic timer that pings independently of backup success.

The helper uses the documented base URL for success and the same URL plus
`/fail` for an immediate execution failure. Do not add command output or exit
codes to failure requests: backup output can contain operational data, and the
unit name already identifies the failed stage.

### 6.3 External schedules and grace

Configure provider schedules in the VPS's actual timezone, not an assumed UTC
translation:

| Check | Expected schedule | Initial grace / latest normal success | Reasoning |
| --- | --- | --- | --- |
| PostgreSQL | 02:30 daily | 90 minutes (alert around 04:00) | permits delayed boot catch-up and unusually slow dumps |
| Analysis history | 02:40 daily | 120 minutes (around 04:40) | archive validation decompresses every stored result and briefly restarts backend |
| Off-site replication | 03:00 daily | 180 minutes (around 06:00) | scans all retained pairs and depends on R2/network throughput |
| Local host check | every 5 minutes | 5 additional minutes | detects loss of the checker/VPS within roughly 10 minutes |

With a provider that supports exact systemd/cron schedules, enter these wall
clock schedules and the VPS timezone. With Better Stack's documented
frequency-based heartbeat, use a 24-hour expected interval plus the listed
grace, initialized by the first verified success. After an unusually delayed
catch-up or maintenance run, verify that the next deadline still matches the
operator's intended window; do not assume interval scheduling reanchors itself
to 02:30/02:40/03:00.

Before rollout, record seven normal durations and tighten grace only if the
observed tail supports it. Maintenance should pause checks in the provider;
do not lengthen grace permanently to hide planned work.

`Persistent=true` means a missed systemd event may run after reboot. If the VPS
was down past the external grace, an alert is correct. The eventual successful
catch-up ping should generate recovery, not erase incident history.

### 6.4 Freshness and artifact age

The local health checker validates that every timer is enabled/active with a
plausible next trigger and that each last-success marker is a regular,
non-symlink file containing a valid UTC timestamp. Maximum marker ages match
the external period plus grace: 25.5 hours for PostgreSQL, 26 hours for analysis
history, and 27 hours for off-site replication.

The five-minute checker should not re-hash every large backup on every run.
The producing scripts already hash and validate before finalization, and the
off-site script re-hashes before upload. A separate once-daily integrity check
may revalidate the newest local pairs if measurements show acceptable cost.
Existence of an arbitrary old file is never sufficient. Artifact-pair validity
remains the producing job's responsibility; re-reading or re-hashing large
backups every five minutes would duplicate expensive validation without adding
a meaningful signal.

## 7. Application monitoring

### 7.1 External probe

Phase 1A adds this exact external contract:

```text
GET https://<HOI4_HTTPS_ORIGIN>/api/readiness

200 {"status":"ok"}
503 {"status":"unavailable"}
```

The path reaches Caddy, NestJS, the existing PostgreSQL pool, and a read-only
`SELECT 1`. The query is bounded to two seconds. Concurrent probes are
coalesced, results are cached for five seconds, and a timed-out underlying
query is reused until it settles instead of allowing repeated requests to
queue more database work. There is no application or edge rate limiter in the
current stack; this small cache/coalescing boundary is the deliberately narrow
abuse control for a constant-size endpoint. It does not add another pool or
write to PostgreSQL.

In the repository Caddy profile, only the exact `/api/readiness` path bypasses
the optional Private Alpha Basic Auth gate. The current production VPS uses the
documented local Caddyfile override without that outer gate. In both cases the
endpoint is explicitly public at Nest's session boundary, so Better Stack needs
no application session, CSRF token, or shared credential. Its body does not
identify PostgreSQL or expose versions, hostnames, paths, users, saves, errors,
or credentials. `Cache-Control: no-store` prevents intermediary reuse of an old
readiness response.

This path does not traverse the frontend container. The later local host check
must therefore also require frontend `running` + `healthy` and edge `running`.
A second public frontend synthetic check can be added later only if real
incidents show this split misses failures; do not store a broad Basic Auth
credential at the provider merely for cosmetic SPA probing.

### 7.2 Better Stack manual configuration

Create the monitor manually in the Better Stack dashboard; do not commit or
script provider tokens for Phase 1A:

| Setting | Phase 1A value |
| --- | --- |
| Monitor type | HTTP status monitor |
| URL | `https://<HOI4_HTTPS_ORIGIN>/api/readiness` |
| Method | `GET` |
| Expected status | HTTP 2xx (`200` in the healthy contract) |
| Check frequency | 3 minutes (current free-plan setting) |
| Request timeout | 5 seconds |
| Failure confirmation | 3 minutes |
| Recovery period | 1 minute |
| IP version | IPv4 only |
| SSL/TLS verification | enabled |
| Authentication/headers | none |

Use email as the durable primary notification and Better Stack mobile push as
the fast secondary notification. Start with one reminder after 30–60 minutes
for an unacknowledged critical incident. Send a provider test alert and verify
both notification and recovery before treating the monitor as operational.

Production acceptance was completed on September 18, 2026 without storing any
provider token in the repository. A controlled backend stop made public
readiness return HTTP 502, Better Stack opened a real incident and delivered
email, restoring the backend returned HTTP 200, and Better Stack automatically
resolved the incident and delivered recovery email. The observed incident ran
approximately four minutes. This verifies the complete edge/provider alert and
recovery path, not only the controller response.

The 02:40 analysis-history snapshot intentionally stops the backend briefly.
The current confirmation window ignored the normal short stop in production
testing while still detecting a failed restoration. During an explicit
maintenance window, pause the monitor with a recorded end time; do not create
a daily mute that could hide a failed restart.

Repository validation is not a production smoke test. After deploying through
the normal operator process, verify from an external network that the exact
readiness URL returns the one-field contract above. On the current VPS, also
verify that the intentional local Caddyfile override remains present and that
application session/ownership behavior is unchanged. Never place application
credentials or a future Basic Auth value into Better Stack.

### 7.3 Readiness incident runbook

When Better Stack opens an incident:

1. Confirm the failure from a second external network with a bounded `GET` to
   the exact readiness URL. Do not add Basic Auth or an application session.
2. Check the VPS/provider status and public DNS/TLS reachability.
3. On the VPS, inspect `docker compose ps` for edge, frontend, backend,
   migration, and PostgreSQL state. An unhealthy backend is a symptom, not an
   instruction to restart it repeatedly.
4. Inspect bounded recent logs for Caddy, backend, PostgreSQL, and the migration
   service. Do not copy secrets, environment dumps, user/save data, or raw SQL
   errors into Better Stack incident notes.
5. Verify PostgreSQL locally with the existing container health state and
   `pg_isready`; do not run migrations or writes as a health test.
6. If the public route fails while containers are healthy, inspect Caddy TLS,
   routing, DNS, firewall, and VPS networking. If it returns 503, focus on the
   backend/database path. An unexpected Basic Auth challenge on the current VPS
   means the intentional production Caddyfile override was lost or bypassed.
7. After repair, require a direct 200 response and Better Stack recovery. Record
   the incident duration and root cause; recovery only proves readiness has
   returned.

Do not automatically restart services, run migrations, prune data, restore a
backup, or rotate credentials solely because this monitor fires. Those actions
require diagnosis and the relevant recovery runbook.

### 7.4 Liveness versus readiness

`GET /api/readiness` is the external product-readiness signal: it is ready only
when the backend and critical PostgreSQL dependency can serve normal requests.
The pre-existing `GET /api/health` compatibility route remains unchanged. It
includes the compact database state and treats intentionally disabled database
mode as healthy for local compatibility. The repository Caddy profile can put
it behind Basic Auth; the current production override does not.

Docker's backend healthcheck deliberately remains on `/api/health`. With the
Private Alpha database enabled, a PostgreSQL outage marks the container
unhealthy. Docker Compose does **not** restart a running container merely
because its health state changed, and `restart: unless-stopped` only applies
after process exit, so this does not create a transient-database restart loop.
Keeping the existing check also avoids changing established startup/dependency
behavior in this monitoring-only phase.

A separate process-only liveness endpoint is not required for Phase 1. It would
only help distinguish Node alive/database down and must never replace readiness
for public uptime. Add it later only if restart automation needs that
distinction. There is therefore no existing liveness contract to change in
Phase 1A.

## 8. Host monitoring

`hoi4-host-health.service` runs the fixed, read-only
`hoi4-save-tracker-host-health` checker. Its timer waits ten minutes after boot,
then runs five minutes after each prior activation. The delay avoids reporting
normal Compose startup as an incident; an enabled monotonic timer is recreated
after every boot without a catch-up burst.

The implementation checks:

1. Docker daemon reachability and its reported data root.
2. Exactly one `postgres`, `backend`, `frontend`, and `edge` container. All must
   be running; the first three must also be healthy. The `migrate` one-shot is
   valid while running or after exit code zero and is never required to remain
   running.
3. All three backup timers are enabled, active, and expose a next trigger no
   more than five minutes in the past or 30 hours in the future.
4. The existing success markers are valid and no older than 25.5 hours for
   PostgreSQL, 26 hours for analysis history, or 27 hours for off-site
   replication. The checker never modifies these three markers.
5. Distinct filesystems containing `/`, Docker data, the project, both local
   backup directories, and monitor state have safe byte and inode headroom.
6. `/proc/meminfo` `MemAvailable`, rather than misleading raw free memory.
7. Per-container restart-count deltas in a rolling 15-minute window. A new
   container ID establishes a baseline instead of alerting on historical data.

Checks write only compact restart/memory state under the existing root-only
monitor directory. A lock prevents overlap. All failures from one run are
logged as sanitized categories and produce one non-zero service result; the
existing allowlisted `OnFailure=` template sends the host monitor's explicit
`/fail`. No success is sent on a failed run. A healthy run sends one
`host-health` success heartbeat; provider/network failure is logged but does
not turn healthy local state into a false host failure. A crashed checker or a
disabled checker timer is detected by the external missed heartbeat.

### 8.1 Initial resource thresholds

Use both percentages and absolute free space. Percentage alone is misleading
on differently sized disks.

| Resource | Warning default | Critical default | Notes |
| --- | --- | --- | --- |
| Filesystem bytes | >=80% used **or** <5 GiB free | >=90% used **or** <2 GiB free | apply to distinct relevant mountpoints; tune after two weeks of backup growth |
| Inodes | >=80% used | >=90% used | especially relevant to Docker layers/logs even though backups are large files |
| Memory | `MemAvailable` <15% for two checks | <8% immediately | use available memory, not raw “free”; transient analysis peaks are expected |
| Restarts | any unexpected increment is warning | >=3 increments within 15 minutes or currently failed/unhealthy | persist only numeric counters/timestamps |

Disk/inode warning and critical conditions both withhold success because the
single host heartbeat is deliberately binary; severity remains visible in the
local journal. One or two restart increments are retained as window state but
do not fail a run until the three-restart threshold is reached. Thresholds are
starting values, not claims about the actual VPS. Record normal disk growth,
peak memory, and backup sizes before tightening them. Swap pressure, kernel OOM
history, and per-process attribution remain limitations of this dependency-free
checker. It never prunes data, restarts services, or deletes Docker objects.

### 8.2 Privilege

Reading the Docker socket is effectively root-equivalent, and the existing
backup directories are root-only. For this single-host profile, a root oneshot
is more honest than placing an unprivileged user in the Docker group. The unit
uses `NoNewPrivileges`, a private temporary directory, a read-only protected
filesystem/home, and a single writable monitor-state path. The script accepts
no HTTP or user input and never uses `eval`.

## 9. Alert delivery

Recommended Phase 1 delivery is hosted-provider **email as the durable primary
channel plus mobile push as the fast secondary channel**. Send a provider test
alert and recovery before relying on it.

Alternatives considered:

- Telegram is practical for one administrator and Healthchecks.io provides an
  official Telegram integration. It is a good optional secondary channel if
  already used, but a custom bot/webhook sender adds another secret and failure
  path.
- Discord webhooks are suitable for a small operations channel, but the webhook
  URL is a bearer secret and chat may be muted. Do not make it the sole critical
  channel.
- Direct VPS email requires an MTA and deliverability work and still cannot send
  when the VPS/network is down. Provider-sent email is preferable.
- SMS/phone can be reserved for later public availability or repeated missed
  critical incidents; it is unnecessary for the initial trusted-user alpha.

Store heartbeat/failure URLs and any webhook credentials only in root-owned
mode-0600 files under `/etc/hoi4-save-tracker/`, referenced by systemd
`EnvironmentFile=` or a curl config file. Never commit them, bake them into an
image, put them in unit files, echo them, enable shell tracing, or include them
in alert text. Treat heartbeat URLs as secrets because forged success pings can
mask an outage.

## 10. Security considerations

- Expose only the exact minimal health endpoint. Do not expose Docker/systemd,
  backup timestamps, filesystem statistics, logs, metrics, or a general
  diagnostics endpoint publicly.
- Validate alert URLs as HTTPS and, where practical, allowlist the chosen
  provider host. Use fixed curl arguments, short timeouts, bounded retries, no
  redirects to arbitrary hosts, and no `eval`/command construction.
- Allowlist the three backup unit names and the host-health unit in the generic
  failure notifier. `%n` must select configuration, never become a command or
  URL fragment.
- Alert payloads contain environment label, component, severity, transition,
  UTC timestamp, and a runbook hint only. Do not send filenames, save hashes,
  user/email data, environment variables, full journal output, filesystem
  paths, SQL errors, R2 object names, or credentials.
- Monitoring must be read-only except for its own state files and outbound
  pings. It must never restart containers, delete backups, rotate logs, or
  mutate R2 automatically.
- Health and heartbeat requests must use bounded response bodies. Never POST
  script stdout/stderr to a third party; provider examples that upload command
  output are inappropriate for this application's data boundary.
- Root execution is limited to fixed oneshot scripts because Docker and backup
  inspection require privileged access. A later agent-based platform must not
  inherit root merely for convenience.
- Review provider retention, account MFA, team access, and incident data region
  before production configuration. Use a separate project for Private Alpha.

## 11. Failure-scenario matrix

| Scenario | Primary detection | Expected alert/recovery | Residual gap |
| --- | --- | --- | --- |
| Backend process/container crashes | external readiness fails; local container state/restart delta | CRITICAL after external confirmation; recovery on 200/healthy | restart policy may recover before the next local sample, but external outage duration/restart delta remains |
| Backend remains alive but unhealthy | readiness returns non-200; Docker/local health state | CRITICAL; include only component and readiness class | root application exception still requires journal inspection |
| PostgreSQL crashes/unavailable | backend readiness executes `SELECT 1`; PostgreSQL Docker health; local checker | CRITICAL application/database dependency; recovery after DB and readiness recover | cannot distinguish storage/network/DB cause remotely |
| Docker daemon stops | external readiness fails; local checker reports Docker unavailable if it can still run | CRITICAL; recovery after Docker/application return | if host networking also fails, only external checks remain |
| Caddy/edge stops | external HTTPS monitor; local edge state | CRITICAL public application unavailable | current edge has no container healthcheck, so process-alive protocol faults depend on external check |
| Frontend stops/unhealthy | local Compose health check | CRITICAL host-health incident; recovery when healthy | external backend readiness can remain green; accepted Phase 1 split |
| VPS loses network | external HTTPS fails and all outbound heartbeats become late | CRITICAL uptime plus heartbeat incidents, deduplicated manually/provider-side | cannot distinguish ISP/firewall/host without VPS-provider console |
| VPS powers off | same as network loss; no local signal required | CRITICAL within HTTPS interval and host-heartbeat grace | exact cause requires provider console |
| PostgreSQL backup fails | non-zero unit triggers `OnFailure`; no success heartbeat; stale state later | immediate CRITICAL job failure, then dead-man confirmation; recovery on next verified success | failure ping can be lost, but missing success remains detectable |
| Analysis-history backup fails | same; external readiness also catches a failed backend restart | immediate CRITICAL; separate app incident if restart failed | archive may have failed after planned interruption; journal/runbook needed |
| R2 unavailable | replication exits non-zero and `OnFailure` fires | CRITICAL off-site replication failure; recovery after verified rerun | local backups remain valid but off-site RPO grows |
| R2 credentials revoked/expired | rclone failure, non-zero unit, missed heartbeat | CRITICAL with generic “replication authentication/remote failure” class | alert must not include rclone config or credentials |
| Backup timer disabled or never fires | scheduled external heartbeat becomes late; local checker sees disabled/inactive timer | CRITICAL missed backup; recovery after timer fixed and successful job | `OnFailure` alone would miss this; dead-man closes it |
| Disk approaches full | local byte/inode threshold | WARNING at 80%/5 GiB; CRITICAL at 90%/2 GiB; recovery below hysteresis threshold | sudden growth between five-minute checks can still fail work |
| Disk fills during backup | script exits non-zero and cleans incomplete pair; `OnFailure`; readiness may fail if broader filesystem affected | CRITICAL backup failure plus host/disk incident | cleanup cannot create free space and may itself log errors under severe ENOSPC |
| Memory pressure/OOM | local sustained `MemAvailable`, container state/restart count | WARNING then CRITICAL; recovery when available memory returns | kernel OOM history and exact per-process attribution are not collected |
| Repeated service crash loop | local restart-count deltas and unhealthy/stopped state; external flapping | CRITICAL after threshold, one incident with recovery | very fast restarts between samples may require Docker events later; deferred |
| Local monitoring script fails | its systemd failure may log/send immediate failure; external host heartbeat expires | CRITICAL “host monitor missed” | same provider outage can delay this alert |
| Monitoring timer disabled | external host heartbeat expires | CRITICAL dead-man incident | none while external provider functions |
| Hosted provider fails | local services, state files and journals continue; pings log bounded failures | no reliable external alert from that provider; verify provider status and test after recovery | accepted single-vendor Private Alpha risk; add second provider only if incidents justify it |
| Alert email delayed/spam | provider mobile push secondary; periodic test | secondary notification or dashboard incident | both channels still share provider; account/MFA recovery is operational work |

## 12. Alert and noise policy

### Severity

- **INFO:** recovery, planned maintenance start/end, optional weekly all-clear
  report. Do not page on ordinary successful runs.
- **WARNING:** disk/inode warning threshold, sustained but non-critical memory,
  stale backup marker, or a monitoring-ping delivery error recorded locally.
- **CRITICAL:** public readiness down after confirmation, required container or
  Docker unavailable, backup job failure/missed deadline, off-site verification
  failure, timer disabled, disk critical/full, critically low memory, or
  host-health heartbeat missed.

### Deduplication and recovery

- Use one aggregate host-health incident plus the existing independent
  application/backup incidents; repeated `/fail` signals update the same
  provider monitor rather than creating per-check monitors.
- Require two or three failed external HTTP probes before opening downtime.
- Memory warning requires two consecutive low samples. Disk/inode recover on a
  later sample below both warning thresholds; no automatic action is attached
  to recovery.
- Send one recovery notification with incident duration. Recovery means the
  check passed again, not that root cause was fixed.
- Let the hosted provider handle reminders/escalation. Start with one reminder
  after 30–60 minutes for unacknowledged CRITICAL incidents; do not send minute
  spam.
- During declared maintenance, pause external checks with a recorded end time.
  Never disable units and rely on memory to re-enable them.
- Test one synthetic failure and recovery quarterly, plus after monitoring
  configuration changes. A monitor that has never alerted is unverified.

## 13. Deployment implications

Phase 1 adds only:

- one exact externally monitorable health route policy at Caddy;
- one small ping/failure helper and root-only secrets file;
- `OnFailure`, post-success state/ping, and timeouts on three existing services;
- one small host-check script, service, timer, and state directory;
- hosted provider configuration and a monitoring runbook.

It does not add a container, database, public metrics endpoint, log collector,
daemon agent, inbound webhook, or application API dependency. Existing
application and backup scripts remain the source of truth for correctness.

Recommended secret/config locations:

```text
/etc/hoi4-save-tracker/monitoring.env       mode 0600 root:root
/var/lib/hoi4-save-tracker-monitor/         mode 0700 root:root
/usr/local/sbin/hoi4-save-tracker-heartbeat mode 0750 root:root
/usr/local/sbin/hoi4-save-tracker-host-health mode 0750 root:root
```

The repository contains example heartbeat configuration with blank URLs only.
Provider monitor IDs, ping URLs, webhook URLs, API keys, email addresses, phone
numbers, and Basic Auth values must not be committed. Installation remains an
explicit operator action followed by `systemd-analyze verify`, daemon reload,
manual service runs, synthetic failures, and recovery verification.

The local checker writes compact state atomically and has a two-minute service
timeout. Its monotonic timer waits ten minutes after each boot and then five
minutes after every activation. The external five-minute heartbeat with grace
remains authoritative during host downtime or a disabled timer.

## 14. Phase 1 implementation plan

Each step should be independently testable and leave existing backup behavior
working.

### PR 1 — External readiness boundary and runbook (production-accepted)

- The exact unauthenticated Caddy exception is `/api/readiness`; all other Basic
  Auth/session/CSRF boundaries remain unchanged.
- The compact endpoint uses the existing pool, a bounded/coalesced `SELECT 1`,
  deterministic 200/503 status, and no dependency detail.
- Focused backend tests and local Caddy/Compose validation require no production
  credentials. The deployed endpoint, real incident, email notification, and
  recovery path were accepted on September 18, 2026.
- Roll back by restoring the prior Caddyfile and removing the readiness handler;
  application data, schemas, and the compatibility `/api/health` route are
  unchanged.

### PR 2 — Backup completion and immediate failure signals (production-accepted)

- Includes a fixed ping helper, blank example secret configuration, atomic
  last-success state, and an allowlisted `OnFailure` template.
- Extends the three service units with non-blocking success reporting,
  `OnFailure=`, and conservative `TimeoutStartSec=` limits.
- Tests success, script failure, alert-network failure, timeout, secret masking,
  exit-code preservation, and no heartbeat before validation completes.
- Real success/failure/recovery signaling has been accepted for all three jobs.

### PR 3 — Local host/disk/timer health checker (production-accepted)

- Implements the fixed checks, thresholds, rolling restart/memory state, and
  independent host-health heartbeat from section 8.
- Uses fixture/fake commands and temporary directories for destructive tests;
  production acceptance must never fill a filesystem or induce memory/OOM
  pressure.
- A controlled stopped-timer failure, fixed reporter routing, and successful
  Better Stack recovery have passed production acceptance.

### PR 4 — Operator documentation and recovery drill (repository complete)

- The operator runbook covers application/DB/Docker, every backup, R2, disk,
  memory, provider incidents, Git/deploy safety, isolated restores, and closure.
- The documented Phase 1D acceptance drill validates an existing
  analysis-history generation in an isolated read-only/no-network container and
  performs no production-data or R2 mutation.
- Execute and record the VPS drill after review. Review normal durations/usage
  after two weeks and adjust grace/thresholds only with evidence.

Do not combine implementation with parser, auth, ownership, backup format,
retention, R2 lifecycle, or deployment-architecture changes.

## 15. Explicitly deferred observability work

The following are intentionally outside Private Alpha Phase 1:

- Prometheus, Grafana, Alertmanager, Loki, OpenTelemetry, ELK, or a metrics TSDB;
- log shipping/search and full SIEM/security analytics;
- per-route latency/error dashboards and user/auth anomaly detection;
- distributed tracing, SLO/error-budget automation, status pages, on-call
  rotations, SMS/phone escalation, or public incident communications;
- Docker event streaming, eBPF, node-exporter agents, automatic remediation,
  automatic backup pruning, or remote commands;
- multi-VPS consensus, monitoring HA, or self-hosting the provider;
- changing backup retention, off-site lifecycle, application health semantics,
  parser/Worker behavior, or production resource limits.

Revisit structured application metrics when traffic, incident history, or more
operators make ad-hoc journal diagnosis inadequate. Revisit a secondary
independent provider if the selected hosted provider causes missed or delayed
alerts. Until then, the proposed five checks cover the failures that matter
without creating a second platform to operate.

## Primary references

- [Better Stack: external HTTP monitoring](https://betterstack.com/docs/uptime/monitoring-start/)
- [Better Stack: cron and heartbeat monitoring](https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/)
- [Better Stack: incident lifecycle](https://betterstack.com/docs/uptime/working-with-incidents/)
- [Healthchecks.io: monitoring cron jobs](https://healthchecks.io/docs/monitoring_cron_jobs/)
- [Healthchecks.io: configuring checks and systemd `OnCalendar`](https://healthchecks.io/docs/configuring_checks/)
- [Healthchecks.io: notifications](https://healthchecks.io/docs/configuring_notifications/)
- [Healthchecks.io: Telegram integration](https://healthchecks.io/integrations/telegram/)
- [UptimeRobot: HTTP monitor setup](https://help.uptimerobot.com/en/articles/11358364-how-to-create-your-first-monitor-on-uptimerobot-quick-setup-guide)
- [Docker Compose service healthchecks and restart policies](https://docs.docker.com/reference/compose-file/services/)
- [Docker restart-policy behavior](https://docs.docker.com/engine/containers/start-containers-automatically/)
- [systemd timer persistence](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)
- [systemd unit failure handling](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html)
