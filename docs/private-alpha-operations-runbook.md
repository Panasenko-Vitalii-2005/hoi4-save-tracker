# Private Alpha operations runbook

This runbook is for the single-VPS Private Alpha deployment at
`https://62-83-9-235.nip.io`. It covers diagnosis, bounded recovery, isolated
restore verification, and incident closure. It does not authorize automatic
remediation or destructive disaster recovery.

## Safety boundary

- Diagnose before restarting anything. A stopped or unhealthy service is a
  symptom, not proof that repeated restarts will help.
- Never use `docker compose down -v`, `git reset --hard`, `git clean`, broad
  filesystem deletion, `docker system prune`, or an R2 delete/sync operation as
  first-line recovery.
- Never extract a backup over the live `analysis-history` volume or restore a
  database dump into production during routine verification.
- Do not print or paste `.env.private-alpha`, `monitoring.env`, the rclone
  configuration, database passwords, Basic Auth values, or Better Stack
  heartbeat URLs. Review logs locally before sharing excerpts.
- Production deliberately has a local
  `deploy/private-alpha/Caddyfile` override with Basic Auth removed. It is an
  intentional production-only change. Preserve and review it during every Git
  update; do not replace it blindly with the repository version.

Destructive disaster recovery starts only after the failure domain is known,
validated local/off-site generations have been selected, a maintenance window
has been declared, and the original data has been preserved.

| Level | Purpose | Examples |
| --- | --- | --- |
| Diagnosis | Read-only evidence gathering | readiness, Compose/systemd state, journals, filesystem usage, object listing |
| Bounded recovery | Restore an understood service without replacing data | start one stopped container, re-enable one timer, rerun one validated job |
| Disaster-recovery escalation | Recover lost/corrupt persistent state | restore into new PostgreSQL/history storage, validate, then perform reviewed cutover |

## Start an operator session

Run these commands from one shell. They define the exact production Compose
context without reading or printing either environment file:

```bash
PROJECT_DIR=/home/vitalii/hoi4-save-tracker
cd -- "$PROJECT_DIR"
compose=(
  sudo docker compose
  --project-directory "$PROJECT_DIR"
  --env-file "$PROJECT_DIR/.env.private-alpha"
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.private-alpha.yml"
)
```

## Fast triage

### Common first minute

```bash
date -Is
uptime
curl --silent --show-error --max-time 5 \
  --write-out '\nHTTP %{http_code}\n' \
  https://62-83-9-235.nip.io/api/readiness
"${compose[@]}" ps --all
sudo systemctl --failed --no-pager
systemctl list-timers --all \
  hoi4-postgres-backup.timer \
  hoi4-analysis-history-backup.timer \
  hoi4-offsite-backup.timer \
  hoi4-host-health.timer
```

Expected healthy state: readiness returns `{"status":"ok"}` with HTTP 200;
`postgres`, `backend`, `frontend`, and `edge` are running; the first three are
healthy; `migrate` has exited zero; all four timers are enabled/active with a
future trigger.

### Application unavailable or readiness failing

```bash
"${compose[@]}" ps --all
"${compose[@]}" logs --since 30m --tail 200 edge frontend backend postgres
sudo journalctl --since '-30 min' --no-pager \
  -u docker.service \
  -u hoi4-host-health.service
sudo docker inspect --format \
  '{{.Name}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}}' \
  $("${compose[@]}" ps --all --quiet postgres backend frontend edge)
```

An external connection/TLS failure with healthy containers points to the edge,
DNS, firewall, VPS network, or certificate path. HTTP 503 points first to the
backend/PostgreSQL dependency. The readiness route does not traverse the
frontend, so also inspect frontend health when only the SPA is unavailable.

### Host-health incident

```bash
sudo systemctl status --no-pager --full \
  hoi4-host-health.service hoi4-host-health.timer
sudo journalctl -u hoi4-host-health.service \
  -u hoi4-monitor-failure@hosthealth.service \
  --since '-30 min' --no-pager
df -hT / /var/lib/docker /home/vitalii/hoi4-save-tracker \
  /var/backups/hoi4-save-tracker/postgres \
  /var/backups/hoi4-save-tracker/analysis-history
df -ih / /var/lib/docker /home/vitalii/hoi4-save-tracker \
  /var/backups/hoi4-save-tracker/postgres \
  /var/backups/hoi4-save-tracker/analysis-history
free -h
sudo stat -c '%n  modified=%y  mode=%a  owner=%U:%G' \
  /var/lib/hoi4-save-tracker-monitor/*.last-success
```

The single sanitized journal line lists failure categories. Use the category to
focus on Docker/container state, timers, backup age, filesystem bytes/inodes,
memory, or restart deltas. Do not edit the checker state to clear an alert.

### Backup or off-site incident

Use the matching service/timer pair:

```bash
JOB=postgres-backup
sudo systemctl status --no-pager --full \
  "hoi4-$JOB.service" "hoi4-$JOB.timer"
sudo journalctl -u "hoi4-$JOB.service" \
  -u 'hoi4-monitor-failure@*' \
  --since '-2 days' --no-pager
```

Valid `JOB` values are `postgres-backup`, `analysis-history-backup`, and
`offsite-backup`. For analysis-history failures, also confirm that the backend
returned to running/healthy. For off-site failures, verify local pairs before
investigating network, R2 availability, or the configured rclone remote.

## Service and timer inspection

```bash
"${compose[@]}" ps --all
sudo systemctl is-enabled \
  hoi4-postgres-backup.timer \
  hoi4-analysis-history-backup.timer \
  hoi4-offsite-backup.timer \
  hoi4-host-health.timer
sudo systemctl is-active \
  hoi4-postgres-backup.timer \
  hoi4-analysis-history-backup.timer \
  hoi4-offsite-backup.timer \
  hoi4-host-health.timer
systemctl list-timers --all \
  hoi4-postgres-backup.timer \
  hoi4-analysis-history-backup.timer \
  hoi4-offsite-backup.timer \
  hoi4-host-health.timer
sudo journalctl --since '-24 hours' --no-pager \
  -u hoi4-postgres-backup.service \
  -u hoi4-analysis-history-backup.service \
  -u hoi4-offsite-backup.service \
  -u hoi4-host-health.service \
  -u 'hoi4-monitor-failure@*'
```

Do not paste unreviewed Compose or journal output into chat or an incident. It
may contain filenames, account metadata, or other operational context even
though the monitoring helpers deliberately sanitize their messages.

## Backup inspection

### Find and verify the newest complete local generations

```bash
latest_complete() {
  local directory="$1"
  local pattern="$2"
  local candidate

  while IFS= read -r candidate; do
    if sudo test -f "$directory/$candidate.sha256"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(sudo find "$directory" -maxdepth 1 -type f \
    -name "$pattern" -printf '%f\n' | sort -r)
  return 1
}

POSTGRES_BACKUP_DIR=/var/backups/hoi4-save-tracker/postgres
HISTORY_BACKUP_DIR=/var/backups/hoi4-save-tracker/analysis-history
LATEST_DUMP="$(latest_complete "$POSTGRES_BACKUP_DIR" \
  'hoi4_????-??-??_??????.dump')"
LATEST_ARCHIVE="$(latest_complete "$HISTORY_BACKUP_DIR" \
  'analysis-history_????-??-??_??????.tar.gz')"
printf 'PostgreSQL: %s\nAnalysis history: %s\n' \
  "$LATEST_DUMP" "$LATEST_ARCHIVE"

sudo bash -eu -c 'cd -- "$1"; sha256sum --check "$2.sha256"' \
  bash "$POSTGRES_BACKUP_DIR" "$LATEST_DUMP"
sudo bash -eu -c 'cd -- "$1"; sha256sum --check "$2.sha256"' \
  bash "$HISTORY_BACKUP_DIR" "$LATEST_ARCHIVE"
sudo docker run --rm \
  -v "$POSTGRES_BACKUP_DIR:/backup:ro" \
  postgres:17-alpine pg_restore --list "/backup/$LATEST_DUMP" \
  > /dev/null
sudo tar -tzf "$HISTORY_BACKUP_DIR/$LATEST_ARCHIVE" > /dev/null
```

Expected result: both `sha256sum` checks say `OK`; `pg_restore --list` and
`tar -tzf` exit zero. A data file without its exact `.sha256` sidecar is not a
complete generation.

### Inspect success markers

```bash
sudo stat -c '%n  modified=%y  mode=%a  owner=%U:%G' \
  /var/lib/hoi4-save-tracker-monitor/postgres.last-success \
  /var/lib/hoi4-save-tracker-monitor/analysis-history.last-success \
  /var/lib/hoi4-save-tracker-monitor/offsite.last-success \
  /var/lib/hoi4-save-tracker-monitor/host-health.last-success
```

Never repair freshness by touching these files. Only a fully successful real
job or host-health run may advance its marker.

### Inspect private R2 presence without exposing credentials

These commands list object names only. Do not run `rclone config show`, add
verbose HTTP logging, or paste the rclone configuration:

```bash
sudo /usr/local/bin/rclone lsf \
  --config /home/vitalii/.config/rclone/rclone.conf \
  --files-only \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/postgres
sudo /usr/local/bin/rclone lsf \
  --config /home/vitalii/.config/rclone/rclone.conf \
  --files-only \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/analysis-history
```

Each complete remote generation has the data object and matching `.sha256`
object. The checksum object is the completion marker.

## Bounded recovery procedures

### Unexpectedly stopped container

First inspect `ps`, the service logs, disk/memory, and dependency health. If the
existing container merely stopped and the cause is understood:

```bash
"${compose[@]}" start postgres
"${compose[@]}" ps postgres
"${compose[@]}" start backend frontend edge
"${compose[@]}" ps --all
curl --silent --show-error --fail --max-time 5 \
  https://62-83-9-235.nip.io/api/readiness
```

Start only the affected services. If the container is missing rather than
stopped, review the current Compose configuration and use
`"${compose[@]}" up -d SERVICE`; do not add `--force-recreate`, remove volumes,
or bring down the entire stack unless a separately approved deployment requires
it. PostgreSQL must be healthy before backend recovery.

### Failed or stopped timer

```bash
TIMER=hoi4-postgres-backup.timer
sudo systemctl enable --now "$TIMER"
systemctl list-timers --all "$TIMER"
sudo systemctl status --no-pager --full "$TIMER"
```

Use the exact affected timer. `Persistent=true` may immediately schedule a
missed daily job after re-enabling it. Watch the corresponding service and do
not start a duplicate manual run.

### Failed backup service

Fix the evidenced cause first: dependency state, free space, permissions,
network/R2 access, or backend restoration. Then run exactly one real job:

```bash
SERVICE=hoi4-postgres-backup.service
sudo systemctl reset-failed "$SERVICE"
sudo systemctl start "$SERVICE"
sudo systemctl status --no-pager --full "$SERVICE"
sudo journalctl -u "$SERVICE" --since '-30 min' --no-pager
```

Use the affected PostgreSQL, analysis-history, or off-site service. Verify its
new complete pair or remote objects and updated success marker. A successful
real job, not a manually edited marker, closes the corresponding heartbeat
incident.

### Failed host-health service

Repair every reported category first, then:

```bash
sudo systemctl reset-failed hoi4-host-health.service
sudo systemctl start hoi4-host-health.service
sudo systemctl status --no-pager --full hoi4-host-health.service
sudo systemctl enable --now hoi4-host-health.timer
sudo stat -c '%n %y' \
  /var/lib/hoi4-save-tracker-monitor/host-health.last-success
```

### Disk or inode pressure

```bash
df -hT
df -ih
sudo du -xhd1 /var /home/vitalii 2>/dev/null | sort -h
sudo docker system df
sudo journalctl --disk-usage
```

Identify the owner of growth before acting. Preserve complete backup pairs and
the R2 copy until recovery is proved. Rotate or remove only specifically
identified expendable data under an approved retention policy. Do not use a
broad Docker prune, delete backup generations ad hoc, or truncate active files
merely to clear the alert.

### Stale backup marker

Inspect the timer/service and latest complete pair. Do not touch the marker.
After correcting the failure, run the corresponding real backup or off-site
service once and verify that the marker timestamp advances.

### Better Stack heartbeat incident

Confirm whether the real local job/check failed or only delivery failed. If the
local result is healthy, inspect outbound DNS/HTTPS, VPS time, and sanitized
journal messages. Do not print the configured URL. Recovery must come from the
next successful real job/check; do not call the capability URL manually to
conceal an unresolved local failure.

### VPS reboot

```bash
uptime
sudo systemctl status --no-pager docker.service
"${compose[@]}" ps --all
systemctl list-timers --all \
  hoi4-postgres-backup.timer \
  hoi4-analysis-history-backup.timer \
  hoi4-offsite-backup.timer \
  hoi4-host-health.timer
sudo systemctl start hoi4-host-health.service
curl --silent --show-error --fail --max-time 5 \
  https://62-83-9-235.nip.io/api/readiness
```

Daily timers are persistent and may run after boot if a schedule was missed.
Do not start duplicate jobs while one is active. A reboot is not a reason to
restore backups unless persistent data is actually missing or corrupt.

## Isolated PostgreSQL restore verification

Use the newest verified complete dump selected above. This creates no
production network attachment or production volume and never targets the live
database:

```bash
sudo docker container inspect hoi4-postgres-restore-test > /dev/null 2>&1 && {
  echo 'Restore-test container already exists; inspect it before continuing.' >&2
  exit 1
}
RESTORE_PASSWORD="$(openssl rand -hex 32)"
sudo docker run -d --name hoi4-postgres-restore-test \
  --network none \
  -v "$POSTGRES_BACKUP_DIR:/backup:ro" \
  -e POSTGRES_DB=hoi4_restore_test \
  -e POSTGRES_USER=hoi4_restore_test \
  -e POSTGRES_PASSWORD="$RESTORE_PASSWORD" \
  postgres:17-alpine

until sudo docker exec hoi4-postgres-restore-test \
  pg_isready -U hoi4_restore_test -d hoi4_restore_test; do sleep 1; done

sudo docker exec -i hoi4-postgres-restore-test \
  pg_restore --exit-on-error --no-owner --no-privileges \
  -U hoi4_restore_test -d hoi4_restore_test \
  "/backup/$LATEST_DUMP"

for table in users sessions analysis_ownership hoi4_schema_migrations; do
  sudo docker exec hoi4-postgres-restore-test psql \
    -U hoi4_restore_test -d hoi4_restore_test -Atc \
    "SELECT '$table', count(*) FROM $table;"
done
```

Expected result: restore exits zero, all four tables exist, and counts are
plausible for the selected checkpoint. Cleanup only the explicitly named
disposable container, including its anonymous test volume:

```bash
sudo docker rm -f -v hoi4-postgres-restore-test
unset RESTORE_PASSWORD
```

An actual production database restore is destructive escalation. It requires a
maintenance window, a fresh target, compatible PostgreSQL and analysis-history
generations, and a separately reviewed cutover plan.

## Isolated analysis-history restore verification

Use the verified archive selected above. Extraction is to a new temporary
directory, never `/app/data` or a Docker volume:

```bash
VALIDATION_DIR="$(mktemp -d /var/tmp/hoi4-analysis-history-validation.XXXXXX)"
sudo tar -xzf "$HISTORY_BACKUP_DIR/$LATEST_ARCHIVE" -C "$VALIDATION_DIR"
sudo test -f "$VALIDATION_DIR/recent-analyses.json"
sudo test -f "$VALIDATION_DIR/shared-analyses.json"
sudo test -d "$VALIDATION_DIR/analysis-results"

BACKEND_IMAGE="$("${compose[@]}" images -q backend)"
test -n "$BACKEND_IMAGE"
sudo docker run --rm --network none --read-only \
  -v "$VALIDATION_DIR:/validation:ro" \
  --entrypoint node "$BACKEND_IMAGE" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const zlib = require("node:zlib");
    for (const name of ["recent-analyses.json", "shared-analyses.json"]) {
      JSON.parse(fs.readFileSync(path.join("/validation", name), "utf8"));
    }
    const directory = "/validation/analysis-results";
    const files = fs.readdirSync(directory)
      .filter((name) => name.endsWith(".json.gz"));
    for (const name of files) {
      const value = zlib.gunzipSync(fs.readFileSync(path.join(directory, name)));
      JSON.parse(value.toString("utf8"));
    }
    console.log(`${files.length} analysis result files validated`);
  '
```

Expected result: both metadata files parse and every compressed AnalyzeResult
decompresses and parses. Cleanup is bounded to the generated temporary path:

```bash
case "$VALIDATION_DIR" in
  /var/tmp/hoi4-analysis-history-validation.*)
    sudo rm -rf -- "$VALIDATION_DIR"
    ;;
  *)
    echo 'Refusing to remove an unexpected validation path.' >&2
    exit 1
    ;;
esac
unset VALIDATION_DIR BACKEND_IMAGE
```

Attaching restored history to an application is destructive escalation. Restore
only into an empty replacement volume while the recovered backend is stopped,
and only with a compatible PostgreSQL recovery point.

## Off-site recovery

List objects with the read-only commands above and select exact data/checksum
pairs from nearby timestamps. Download into a new private directory; never use
`sync`, `move`, `delete`, `purge`, or the live backup directories:

```bash
RECOVERY_DIR="$(mktemp -d /var/tmp/hoi4-r2-recovery.XXXXXX)"
chmod 0700 "$RECOVERY_DIR"
PG_OBJECT=hoi4_YYYY-MM-DD_HHMMSS.dump
HISTORY_OBJECT=analysis-history_YYYY-MM-DD_HHMMSS.tar.gz
[[ "$PG_OBJECT" =~ ^hoi4_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$ ]]
[[ "$HISTORY_OBJECT" =~ ^analysis-history_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.tar\.gz$ ]]

for object in "$PG_OBJECT" "$PG_OBJECT.sha256"; do
  sudo /usr/local/bin/rclone copyto \
    --config /home/vitalii/.config/rclone/rclone.conf \
    "hoi4-r2:hoi4-save-tracker-backups/private-alpha/postgres/$object" \
    "$RECOVERY_DIR/$object"
done
for object in "$HISTORY_OBJECT" "$HISTORY_OBJECT.sha256"; do
  sudo /usr/local/bin/rclone copyto \
    --config /home/vitalii/.config/rclone/rclone.conf \
    "hoi4-r2:hoi4-save-tracker-backups/private-alpha/analysis-history/$object" \
    "$RECOVERY_DIR/$object"
done

sudo bash -eu -c 'cd -- "$1"; sha256sum --check "$2.sha256"; sha256sum --check "$3.sha256"' \
  bash "$RECOVERY_DIR" "$PG_OBJECT" "$HISTORY_OBJECT"
sudo docker run --rm -v "$RECOVERY_DIR:/recovery:ro" \
  postgres:17-alpine pg_restore --list "/recovery/$PG_OBJECT" > /dev/null
sudo tar -tzf "$RECOVERY_DIR/$HISTORY_OBJECT" > /dev/null
```

Continue with isolated restore verification before considering production
recovery. Cleanup only after the selected downloads and checks have served their
purpose:

```bash
case "$RECOVERY_DIR" in
  /var/tmp/hoi4-r2-recovery.*) sudo rm -rf -- "$RECOVERY_DIR" ;;
  *) echo 'Refusing to remove an unexpected recovery path.' >&2; exit 1 ;;
esac
```

## Production Git and deployment safety

Before fetching or updating:

```bash
cd /home/vitalii/hoi4-save-tracker
git status --short
git diff -- deploy/private-alpha/Caddyfile
git diff --name-only
git fetch origin
git diff --name-status HEAD..origin/main
git diff HEAD..origin/main -- deploy/private-alpha/Caddyfile
```

The local Caddyfile change that removes Basic Auth is intentional production
state. If the incoming branch also changes that file, stop and merge it
manually. Never use `git reset --hard`, `git clean`, checkout/restore of the
Caddyfile, or a blind force-copy to make an update pass. After an update, repeat
`git status` and `git diff` and verify that only documented production overrides
remain.

Do not expose the ignored `.env.private-alpha`, root-only monitoring files,
rclone config, or heartbeat URLs while diagnosing Git/deployment issues.

## Monitoring ownership and maintenance

- Keep the Better Stack account owner and one recovery contact in the private
  operator record, with MFA and recovery codes stored outside this repository.
- The three backup timers use server-local time at 02:30, 02:40, and 03:00;
  verify the VPS timezone with `timedatectl` after provisioning or clock work.
  Host-health runs every five minutes after its initial ten-minute boot delay.
- Rotate one heartbeat URL at a time by editing the root-only
  `/etc/hoi4-save-tracker/monitoring.env`, restoring mode `0600`, running the
  corresponding fixed notifier during a declared test window, and then running
  the real job/check to prove recovery. Never place the old or new URL on a
  command line or in an incident note.
- Rotate R2 credentials only in the existing private rclone configuration.
  Validate with `rclone lsf`; never use `rclone config show` or debug HTTP
  output. Then run the real off-site service and confirm its success marker.
- Exercise one controlled alert and recovery quarterly and after monitoring
  wiring changes. Pause provider notifications only for a recorded maintenance
  window with an end time; never leave a monitor silently disabled.

## Incident closure checklist

- [ ] Root cause is understood, or at least isolated to one failure domain.
- [ ] The affected container/service is running and healthy.
- [ ] The affected timer is enabled, active, and has a plausible next trigger.
- [ ] The relevant real backup/replication job succeeds when appropriate.
- [ ] The relevant success marker advanced because that real job succeeded.
- [ ] `/api/readiness` is HTTP 200 and the SPA is reachable.
- [ ] `hoi4-host-health.service` passes.
- [ ] Better Stack shows recovery for every incident opened during the event.
- [ ] No monitoring or backup timer remains stopped.
- [ ] No unverified backup was restored or production volume overwritten.
- [ ] Git status/diff contains only documented intentional production overrides.
- [ ] Incident time, impact, commands run, cause, repair, and follow-up are
  recorded without secrets.

## Phase 1D non-destructive recovery drill

Use a maintenance/test window. This drill chooses analysis-history isolated
extraction because it validates a real checksum, archive, both metadata files,
and every compressed persisted result without creating a database, stopping the
backend, or mounting the live `/app/data` volume into the validation container.

### 1. Pre-flight health and schedules

Initialize `PROJECT_DIR` and `compose` as at the start of this runbook, then:

```bash
curl --silent --show-error --fail --max-time 5 \
  https://62-83-9-235.nip.io/api/readiness
"${compose[@]}" ps --all
systemctl list-timers --all \
  hoi4-postgres-backup.timer \
  hoi4-analysis-history-backup.timer \
  hoi4-offsite-backup.timer \
  hoi4-host-health.timer
sudo stat -c '%n  modified=%y' \
  /var/lib/hoi4-save-tracker-monitor/postgres.last-success \
  /var/lib/hoi4-save-tracker-monitor/analysis-history.last-success \
  /var/lib/hoi4-save-tracker-monitor/offsite.last-success \
  /var/lib/hoi4-save-tracker-monitor/host-health.last-success
```

Expected: readiness succeeds; application containers are healthy/running; all
four timers have future triggers; all four markers exist with plausible ages.

### 2. Identify local and off-site generations

Define `latest_complete` as in **Backup inspection**, then:

```bash
POSTGRES_BACKUP_DIR=/var/backups/hoi4-save-tracker/postgres
HISTORY_BACKUP_DIR=/var/backups/hoi4-save-tracker/analysis-history
LATEST_DUMP="$(latest_complete "$POSTGRES_BACKUP_DIR" \
  'hoi4_????-??-??_??????.dump')"
LATEST_ARCHIVE="$(latest_complete "$HISTORY_BACKUP_DIR" \
  'analysis-history_????-??-??_??????.tar.gz')"
printf 'Latest local PostgreSQL: %s\nLatest local history: %s\n' \
  "$LATEST_DUMP" "$LATEST_ARCHIVE"
sudo bash -eu -c 'cd -- "$1"; sha256sum --check "$2.sha256"' \
  bash "$POSTGRES_BACKUP_DIR" "$LATEST_DUMP"
sudo bash -eu -c 'cd -- "$1"; sha256sum --check "$2.sha256"' \
  bash "$HISTORY_BACKUP_DIR" "$LATEST_ARCHIVE"

sudo /usr/local/bin/rclone lsf \
  --config /home/vitalii/.config/rclone/rclone.conf --files-only \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/postgres \
  | grep -Fx "$LATEST_DUMP"
sudo /usr/local/bin/rclone lsf \
  --config /home/vitalii/.config/rclone/rclone.conf --files-only \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/postgres \
  | grep -Fx "$LATEST_DUMP.sha256"
sudo /usr/local/bin/rclone lsf \
  --config /home/vitalii/.config/rclone/rclone.conf --files-only \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/analysis-history \
  | grep -Fx "$LATEST_ARCHIVE"
sudo /usr/local/bin/rclone lsf \
  --config /home/vitalii/.config/rclone/rclone.conf --files-only \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/analysis-history \
  | grep -Fx "$LATEST_ARCHIVE.sha256"
```

Expected: both local checksum checks report `OK`; each latest data object and
its sidecar is present remotely. These commands perform no remote writes.

### 3. Prove isolated analysis-history recovery

Run the complete **Isolated analysis-history restore verification** section.
Expected output is `N analysis result files validated`, where `N` is a
non-negative integer appropriate for the selected generation. The validation
container has no network, a read-only root filesystem, and only the isolated
extraction mounted read-only.

Run its guarded cleanup immediately afterward. Confirm that the live Compose
services remained running throughout:

```bash
"${compose[@]}" ps --all
```

### 4. Post-drill health and closure

```bash
sudo systemctl start hoi4-host-health.service
sudo systemctl status --no-pager --full hoi4-host-health.service
curl --silent --show-error --fail --max-time 5 \
  https://62-83-9-235.nip.io/api/readiness
systemctl list-timers --all \
  hoi4-postgres-backup.timer \
  hoi4-analysis-history-backup.timer \
  hoi4-offsite-backup.timer \
  hoi4-host-health.timer
git status --short
git diff -- deploy/private-alpha/Caddyfile
```

Expected: host-health passes, readiness is HTTP 200, all four timers remain
active with future triggers, and Git still shows only the intentional production
override. Record the selected generation, validated result count, start/end
time, and outcome without recording credentials or heartbeat URLs.

## Remaining Private Alpha limitations

- PostgreSQL and analysis-history generations are close in time but not an
  atomic cross-store snapshot.
- R2 replication is append-only and has no reviewed off-site retention policy.
- Restore cutover is manual and intentionally not automated.
- Monitoring uses one hosted provider; a provider outage can delay alerts.
- The host checker samples restart counters rather than consuming Docker events.
- Full disaster recovery still requires a maintenance window and coordinated
  PostgreSQL plus analysis-history restoration on isolated/new storage.
