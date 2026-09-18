# Private Alpha deployment

This profile is intentionally limited to **2–5 trusted users**, **one Linux VPS**, and **one backend instance**. It is suitable for private alpha testing, not for a public closed beta.

## Architecture and exposure

`docker-compose.private-alpha.yml` is an override for the normal development Compose file. Caddy is the only public application entry point. It terminates TLS, redirects HTTP to HTTPS, and applies HTTP Basic Auth before routing either the SPA or `/api/*`. Existing application registration, login, opaque sessions, CSRF, and ownership checks remain active behind that deployment gate.

Expected VPS ingress:

- TCP 22 for operator-controlled SSH, preferably source-restricted;
- TCP 80 for ACME validation and HTTPS redirect;
- TCP 443 for the application.

Do not expose 3001 or 5432. The frontend, backend and PostgreSQL services have no host ports in this profile. PostgreSQL uses an internal Docker network. The only host bind from this repository is the read-only Caddy configuration; `./saves` is deliberately not mounted.

Persistent named volumes are:

- `postgres-data`: users, sessions and analysis ownership;
- `analysis-history`: compressed AnalyzeResult artifacts, Recent metadata and share metadata;
- `caddy-data` and `caddy-config`: Caddy certificate/configuration state.

Never use `docker compose down -v` unless all of this data is intentionally being destroyed.

## VPS sizing

Start with at least 2 vCPU, 4 GiB RAM and 20–40 GiB of SSD space for a small private alpha. One analysis Worker may use roughly 1 GiB of old-generation V8 heap in addition to the backend, PostgreSQL, proxy and operating system. Keep one backend replica and one Worker unless measurements on the actual VPS justify a change.

## Operator configuration

Install Docker Engine with the Compose v2 plugin, clone the repository, then create the ignored deployment environment file:

```bash
cp .env.private-alpha.example .env.private-alpha
chmod 600 .env.private-alpha
```

Fill every blank value. Use simple PostgreSQL identifiers and a URL-safe random password so the composed `DATABASE_URL` remains valid:

```bash
openssl rand -hex 32
```

Set `HOI4_HTTPS_ORIGIN` to the exact public origin, for example `https://hoi4.example.com`, with no path or trailing slash. Point that hostname's DNS A/AAAA records at the VPS. Set `ACME_EMAIL` to the operator's real address.

Generate the private-alpha password hash interactively so the plaintext is not written to the repository:

```bash
docker run --rm -it caddy:2.10-alpine caddy hash-password
```

Set `PRIVATE_ALPHA_USERNAME` and paste the bcrypt output into `PRIVATE_ALPHA_PASSWORD_HASH` between the existing single quotes. The quotes keep `$` characters literal. The ignored env file contains the database password and access-gate hash; do not commit, publish or back it up insecurely.

Verify that missing required values fail configuration, then render and inspect the final profile:

```bash
docker compose --env-file .env.private-alpha \
  -f docker-compose.yml \
  -f docker-compose.private-alpha.yml \
  config --quiet

docker compose --env-file .env.private-alpha \
  -f docker-compose.yml \
  -f docker-compose.private-alpha.yml \
  config
```

Confirm before starting that only the `edge` service publishes ports, backend uses `HOI4_SESSION_COOKIE_SECURE=true`, `HOI4_LOCAL_SAVES_ENABLED=false`, and no service mounts `./saves`.

## Deploy and verify

Start the profile:

```bash
docker compose --env-file .env.private-alpha \
  -f docker-compose.yml \
  -f docker-compose.private-alpha.yml \
  up -d --build
```

The one-shot `migrate` service must complete before the backend starts. Inspect status and migration logs:

```bash
docker compose --env-file .env.private-alpha \
  -f docker-compose.yml \
  -f docker-compose.private-alpha.yml \
  ps

docker compose --env-file .env.private-alpha \
  -f docker-compose.yml \
  -f docker-compose.private-alpha.yml \
  logs migrate
```

Verify the two security layers:

```bash
curl -I https://hoi4.example.com/
curl -u 'alpha-user' https://hoi4.example.com/api/health
```

Replace the example host and user. The first request must return `401`; the second must reach the Nest health endpoint and report `{"status":"ok","database":"ok"}`. If the reachable backend reports its required database unavailable, health returns HTTP 503. A hard database connection loss can instead produce a brief proxy 502 while the single backend is restarted by Compose. Opening the HTTPS URL in a browser must first request the private-alpha credential and then show the normal application registration/login flow.

Register a normal application account, sign in, upload a `.hoi4` file, and reopen its persisted analysis. Local server-side save browsing remains disabled; browser upload is the supported input path.

To verify recreation without deleting volumes:

```bash
docker compose --env-file .env.private-alpha \
  -f docker-compose.yml \
  -f docker-compose.private-alpha.yml \
  up -d --force-recreate backend frontend edge
```

Sign in again if necessary and confirm the account and persisted analysis still exist.

## Automated PostgreSQL backup

The repository provides a small logical-backup script and a systemd timer for the Private Alpha PostgreSQL 17 service. The script uses the credentials already supplied through `.env.private-alpha`; it does not copy the PostgreSQL data volume or print credentials. Each run:

1. writes a custom-format `pg_dump` to a private temporary file;
2. rejects an empty dump and validates it with `pg_restore --list`;
3. atomically renames the validated dump to `hoi4_YYYY-MM-DD_HHMMSS.dump`;
4. writes a matching SHA-256 file;
5. retains the seven newest complete backup pairs by default.

The default destination is `/var/backups/hoi4-save-tracker/postgres`. The directory is mode `0700`; dumps and checksums are mode `0600`. Retention runs only after a new dump and checksum have been finalized, considers only files matching the backup naming convention, and leaves unrelated or incomplete files alone. A lock prevents overlapping runs. Any dump, validation, checksum or finalization failure exits non-zero and removes the incomplete generation.

Install the script, its non-secret configuration, and the systemd units from the repository checkout. Replace `/opt/hoi4-save-tracker` in the configuration if the checkout lives elsewhere:

```bash
sudo install -m 0750 deploy/private-alpha/backup-postgres.sh \
  /usr/local/sbin/hoi4-save-tracker-postgres-backup
sudo install -d -m 0755 /etc/hoi4-save-tracker
sudo install -m 0600 deploy/private-alpha/postgres-backup.env.example \
  /etc/hoi4-save-tracker/postgres-backup.env
sudo editor /etc/hoi4-save-tracker/postgres-backup.env
sudo install -m 0644 deploy/private-alpha/hoi4-postgres-backup.service \
  /etc/systemd/system/hoi4-postgres-backup.service
sudo install -m 0644 deploy/private-alpha/hoi4-postgres-backup.timer \
  /etc/systemd/system/hoi4-postgres-backup.timer
sudo systemctl daemon-reload
```

Run and inspect one backup before enabling the schedule:

```bash
sudo systemctl start hoi4-postgres-backup.service
sudo systemctl status hoi4-postgres-backup.service
sudo journalctl -u hoi4-postgres-backup.service
sudo ls -la /var/backups/hoi4-save-tracker/postgres
```

Only after that succeeds, enable the daily 02:30 server-local timer. `Persistent=true` causes a missed run to execute after the VPS next starts:

```bash
sudo systemctl enable --now hoi4-postgres-backup.timer
systemctl list-timers hoi4-postgres-backup.timer
```

The repository does not install or enable these units automatically. Check failures through the service status and journal. Systemd retains the command output according to the VPS journal policy:

```bash
sudo journalctl -u hoi4-postgres-backup.service --since today
```

### Verify and rehearse a restore

Locate the newest complete generation and verify it without touching production:

```bash
BACKUP_DIR=/var/backups/hoi4-save-tracker/postgres
LATEST_DUMP=
while IFS= read -r candidate; do
  if [ -f "$BACKUP_DIR/$candidate.sha256" ]; then
    LATEST_DUMP=$candidate
    break
  fi
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f \
  -name 'hoi4_????-??-??_??????.dump' -printf '%f\n' | sort -r)
test -n "$LATEST_DUMP"
cd "$BACKUP_DIR"
sha256sum --check "$LATEST_DUMP.sha256"
docker run --rm -i postgres:17-alpine pg_restore --list < "$LATEST_DUMP" > /dev/null
```

Restore rehearsals must use a disposable PostgreSQL 17 container and database. **Do not restore over the live production database during verification.** This example creates an isolated container with test-only credentials and no production network or volume:

```bash
RESTORE_PASSWORD=$(openssl rand -hex 32)
docker run -d --name hoi4-postgres-restore-test \
  -e POSTGRES_DB=hoi4_restore_test \
  -e POSTGRES_USER=hoi4_restore_test \
  -e POSTGRES_PASSWORD="$RESTORE_PASSWORD" \
  postgres:17-alpine

until docker exec hoi4-postgres-restore-test \
  pg_isready -U hoi4_restore_test -d hoi4_restore_test; do sleep 1; done

docker exec -i hoi4-postgres-restore-test \
  pg_restore --exit-on-error --no-owner --no-privileges \
  -U hoi4_restore_test -d hoi4_restore_test < "$BACKUP_DIR/$LATEST_DUMP"

for table in users sessions analysis_ownership hoi4_schema_migrations; do
  docker exec hoi4-postgres-restore-test psql \
    -U hoi4_restore_test -d hoi4_restore_test -Atc \
    "SELECT '$table', count(*) FROM $table;"
done
```

Compare those four row counts with read-only production counts taken at the same backup checkpoint. Inspect login/ownership behavior only in an isolated application environment if further validation is needed. When the rehearsal is complete, remove only the explicitly named disposable container:

```bash
docker rm -f hoi4-postgres-restore-test
unset RESTORE_PASSWORD
```

The PostgreSQL dump covers users, sessions, analysis ownership and schema-migration state. The separate `analysis-history` volume contains compressed AnalyzeResult artifacts, Recent metadata and share metadata; it requires the separate backup described below. **A PostgreSQL backup alone is not complete application disaster recovery.**

## Automated analysis-history backup

The `analysis-history` backup is deliberately separate from PostgreSQL. It archives only the Compose-mounted `/app/data` contents: `recent-analyses.json`, `shared-analyses.json`, and `analysis-results/*.json.gz`. It does not inspect Docker's host-internal volume path and does not include PostgreSQL, Caddy data, the repository, save uploads, or `.env.private-alpha`.

For a consistent filesystem snapshot, the script detects whether the single Private Alpha backend is running. If it is, the script stops that service, creates the small archive through a one-off container using the same Compose volume, and immediately restarts the backend before performing full validation. The EXIT/signal cleanup path also attempts the restart if archive creation fails. A backend that was already stopped is never started by the backup. PostgreSQL, frontend, and edge remain running.

Each successful run writes a private temporary archive, validates its tar/gzip structure, extracts it into an isolated temporary directory, parses both metadata JSON files, decompresses and parses every result JSON, then atomically finalizes `analysis-history_YYYY-MM-DD_HHMMSS.tar.gz` and its SHA-256 file. The default destination is `/var/backups/hoi4-save-tracker/analysis-history`; the directory is mode `0700`, and archives/checksums are mode `0600`. A separate lock prevents overlapping history backups. Retention runs only after a complete new pair exists and keeps the seven newest complete pairs by default.

Install the script, configuration, and units. Replace `/opt/hoi4-save-tracker` if the checkout lives elsewhere:

```bash
sudo install -m 0750 deploy/private-alpha/backup-analysis-history.sh \
  /usr/local/sbin/hoi4-save-tracker-analysis-history-backup
sudo install -d -m 0755 /etc/hoi4-save-tracker
sudo install -m 0600 deploy/private-alpha/analysis-history-backup.env.example \
  /etc/hoi4-save-tracker/analysis-history-backup.env
sudo editor /etc/hoi4-save-tracker/analysis-history-backup.env
sudo install -m 0644 deploy/private-alpha/hoi4-analysis-history-backup.service \
  /etc/systemd/system/hoi4-analysis-history-backup.service
sudo install -m 0644 deploy/private-alpha/hoi4-analysis-history-backup.timer \
  /etc/systemd/system/hoi4-analysis-history-backup.timer
sudo systemctl daemon-reload
```

Run and inspect one backup before enabling its timer:

```bash
sudo systemctl start hoi4-analysis-history-backup.service
sudo systemctl status hoi4-analysis-history-backup.service
sudo journalctl -u hoi4-analysis-history-backup.service
sudo ls -la /var/backups/hoi4-save-tracker/analysis-history
```

Only after the manual run succeeds, enable the daily 02:40 server-local schedule:

```bash
sudo systemctl enable --now hoi4-analysis-history-backup.timer
systemctl list-timers hoi4-postgres-backup.timer hoi4-analysis-history-backup.timer
```

`Persistent=true` catches a missed run after reboot. The ten-minute offset from the 02:30 PostgreSQL timer keeps the recovery points close without normally overlapping their disk work. The backups remain independently valid; no cross-service lock or false exact pairing requirement is introduced. The repository does not install or enable either timer automatically.

### Verify and rehearse an analysis-history restore

Locate the newest complete archive/checksum pair and verify checksum plus archive listing:

```bash
BACKUP_DIR=/var/backups/hoi4-save-tracker/analysis-history
LATEST_ARCHIVE=
while IFS= read -r candidate; do
  if [ -f "$BACKUP_DIR/$candidate.sha256" ]; then
    LATEST_ARCHIVE=$candidate
    break
  fi
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f \
  -name 'analysis-history_????-??-??_??????.tar.gz' -printf '%f\n' | sort -r)
test -n "$LATEST_ARCHIVE"
cd "$BACKUP_DIR"
sha256sum --check "$LATEST_ARCHIVE.sha256"
tar -tzf "$LATEST_ARCHIVE" > /dev/null
```

Routine verification must extract into an isolated directory, **never over the live production volume**:

```bash
VALIDATION_DIR=$(mktemp -d /var/tmp/hoi4-analysis-history-validation.XXXXXX)
tar -xzf "$BACKUP_DIR/$LATEST_ARCHIVE" -C "$VALIDATION_DIR"
test -f "$VALIDATION_DIR/recent-analyses.json"
test -f "$VALIDATION_DIR/shared-analyses.json"
test -d "$VALIDATION_DIR/analysis-results"

docker compose --env-file .env.private-alpha \
  -f docker-compose.yml \
  -f docker-compose.private-alpha.yml \
  run --rm --no-deps -T \
  -v "$VALIDATION_DIR:/validation:ro" \
  --entrypoint node backend -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const zlib = require("node:zlib");
    for (const name of ["recent-analyses.json", "shared-analyses.json"]) {
      JSON.parse(fs.readFileSync(path.join("/validation", name), "utf8"));
    }
    const directory = "/validation/analysis-results";
    const files = fs.readdirSync(directory).filter((name) => name.endsWith(".json.gz"));
    for (const name of files) {
      JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(directory, name))).toString("utf8"));
    }
    console.log(`${files.length} analysis result files validated`);
  '

case "$VALIDATION_DIR" in
  /var/tmp/hoi4-analysis-history-validation.*) rm -rf -- "$VALIDATION_DIR" ;;
  *) echo "Refusing to remove an unexpected validation path" >&2; exit 1 ;;
esac
```

For an actual disaster recovery, select PostgreSQL and history generations from compatible, nearby timestamps. Restore history only into an empty/new volume while the recovered backend is stopped. This example uses a clearly isolated replacement volume; inspect it before connecting it to any recovered deployment:

```bash
RESTORE_VOLUME=hoi4-save-tracker-alpha_analysis-history-restore
docker volume create "$RESTORE_VOLUME"
docker compose --env-file .env.private-alpha \
  -f docker-compose.yml \
  -f docker-compose.private-alpha.yml \
  run --rm --no-deps -T \
  -v "$RESTORE_VOLUME:/restore" \
  -v "$BACKUP_DIR:/backup:ro" \
  --entrypoint sh backend -eu -c \
  'test -z "$(ls -A /restore)"; tar -xzf "/backup/'"$LATEST_ARCHIVE"'" -C /restore'
```

Do not attach or substitute the restored volume until its JSON/gzip validation passes and the compatible PostgreSQL recovery point is ready. Never extract a routine verification archive over `/app/data` or a live named volume.

## Automated off-site replication

The third backup layer copies completed local PostgreSQL and `analysis-history` generations to bucket-scoped Cloudflare R2 storage through the operator's existing rclone remote. It does not create backups itself and never reads PostgreSQL, `/app/data`, Docker volumes, application secrets, or `.env.private-alpha`. Its trust boundary is the finalized local pair: strict filename, data file, matching checksum file, and a successful local SHA-256 verification.

Every run scans all locally retained generations rather than only the newest one. This repairs missed timers, network outages, VPS downtime, or a prior partial upload while local retention still contains the generation. The deterministic object layout is:

```text
hoi4-save-tracker-backups/
└── private-alpha/
    ├── postgres/
    │   ├── hoi4_YYYY-MM-DD_HHMMSS.dump
    │   └── hoi4_YYYY-MM-DD_HHMMSS.dump.sha256
    └── analysis-history/
        ├── analysis-history_YYYY-MM-DD_HHMMSS.tar.gz
        └── analysis-history_YYYY-MM-DD_HHMMSS.tar.gz.sha256
```

For each pair, the data object is uploaded first. The script downloads it to a private temporary directory and verifies SHA-256 against the locally validated checksum. Only then is the checksum object uploaded and downloaded for an exact comparison. Therefore the checksum object is the completion marker for a remote generation. A failed checksum upload leaves at most an orphan data object; the next run repairs it safely. Existing identical objects are verified and skipped rather than duplicated.

The script deliberately does not use `sync`, `move`, remote delete flags, or purge. Local backups are never deleted by replication. R2 storage is append-only in this initial version and will grow until a separately reviewed off-site retention policy is implemented.

The production rclone config remains outside the repository. The root systemd service receives its absolute path explicitly and does not rely on root's `HOME`. The currently verified production path is `/home/vitalii/.config/rclone/rclone.conf`; retain its existing bucket-scoped R2 permissions and do not copy its credentials into the environment file.

Install the script, root-readable configuration, and units. Confirm the actual rclone binary path with `command -v rclone`; rclone 1.75.0 or newer is required:

```bash
sudo install -m 0750 deploy/private-alpha/replicate-backups-offsite.sh \
  /usr/local/sbin/hoi4-save-tracker-offsite-backup
sudo install -d -m 0755 /etc/hoi4-save-tracker
sudo install -m 0600 deploy/private-alpha/offsite-backup.env.example \
  /etc/hoi4-save-tracker/offsite-backup.env
sudo editor /etc/hoi4-save-tracker/offsite-backup.env
sudo install -m 0644 deploy/private-alpha/hoi4-offsite-backup.service \
  /etc/systemd/system/hoi4-offsite-backup.service
sudo install -m 0644 deploy/private-alpha/hoi4-offsite-backup.timer \
  /etc/systemd/system/hoi4-offsite-backup.timer
sudo systemctl daemon-reload
```

Set the production configuration to the existing remote, bucket, prefix, and explicit config path; these values identify storage but contain no R2 key material:

```text
HOI4_OFFSITE_RCLONE_BIN=/usr/local/bin/rclone
HOI4_OFFSITE_RCLONE_CONFIG=/home/vitalii/.config/rclone/rclone.conf
HOI4_OFFSITE_RCLONE_REMOTE=hoi4-r2
HOI4_OFFSITE_BUCKET=hoi4-save-tracker-backups
HOI4_OFFSITE_PREFIX=private-alpha
```

Run and inspect one replication before scheduling it. Do not use `rclone config show` in operational checks:

```bash
sudo systemctl start hoi4-offsite-backup.service
sudo systemctl status hoi4-offsite-backup.service
sudo journalctl -u hoi4-offsite-backup.service
sudo -u root /usr/local/bin/rclone lsf \
  --config /home/vitalii/.config/rclone/rclone.conf \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/postgres
sudo -u root /usr/local/bin/rclone lsf \
  --config /home/vitalii/.config/rclone/rclone.conf \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/analysis-history
```

Only after that manual run passes, enable the daily 03:00 server-local timer. Its failures affect only replication; they do not stop or restart the application:

```bash
sudo systemctl enable --now hoi4-offsite-backup.timer
systemctl list-timers \
  hoi4-postgres-backup.timer \
  hoi4-analysis-history-backup.timer \
  hoi4-offsite-backup.timer
```

## Backup success/failure heartbeat monitoring

Phase 1B adds three independent Better Stack heartbeat monitors around the
existing jobs. It does not change backup formats, retention, R2 permissions, or
restore behavior. Each script sends success only after its complete validation
and retention/remote-verification path finishes. A failed job sends no success
and its systemd unit attempts the provider's explicit `/fail` signal.

Create these three heartbeat monitors manually in Better Stack before filling
the configuration:

| Monitor | Expected interval | Grace | Configuration variable |
| --- | ---: | ---: | --- |
| PostgreSQL backup | 24 hours | 90 minutes | `HOI4_MONITOR_POSTGRES_HEARTBEAT_URL` |
| Analysis-history backup | 24 hours | 120 minutes | `HOI4_MONITOR_ANALYSIS_HISTORY_HEARTBEAT_URL` |
| Off-site replication | 24 hours | 180 minutes | `HOI4_MONITOR_OFFSITE_HEARTBEAT_URL` |

Install curl, the shared helper, blank root-only configuration, failure unit,
and the updated backup services. The helper accepts only HTTPS heartbeat URLs
on Better Stack's official heartbeat endpoint and never logs their values:

```bash
sudo apt-get update
sudo apt-get install -y curl
test "$(command -v curl)" = /usr/bin/curl

sudo systemctl stop \
  hoi4-postgres-backup.timer \
  hoi4-analysis-history-backup.timer \
  hoi4-offsite-backup.timer
systemctl is-active \
  hoi4-postgres-backup.service \
  hoi4-analysis-history-backup.service \
  hoi4-offsite-backup.service
# All three services must be inactive before replacing their scripts.

sudo install -m 0750 deploy/private-alpha/backup-postgres.sh \
  /usr/local/sbin/hoi4-save-tracker-postgres-backup
sudo install -m 0750 deploy/private-alpha/backup-analysis-history.sh \
  /usr/local/sbin/hoi4-save-tracker-analysis-history-backup
sudo install -m 0750 deploy/private-alpha/replicate-backups-offsite.sh \
  /usr/local/sbin/hoi4-save-tracker-offsite-backup

sudo install -m 0750 deploy/private-alpha/monitoring-heartbeat.sh \
  /usr/local/sbin/hoi4-save-tracker-heartbeat
sudo install -d -m 0755 /etc/hoi4-save-tracker
sudo install -m 0600 deploy/private-alpha/monitoring.env.example \
  /etc/hoi4-save-tracker/monitoring.env
sudo chown root:root /etc/hoi4-save-tracker/monitoring.env
sudo editor /etc/hoi4-save-tracker/monitoring.env

sudo install -m 0644 deploy/private-alpha/hoi4-monitor-failure@.service \
  /etc/systemd/system/hoi4-monitor-failure@.service
sudo install -m 0644 deploy/private-alpha/hoi4-postgres-backup.service \
  /etc/systemd/system/hoi4-postgres-backup.service
sudo install -m 0644 deploy/private-alpha/hoi4-analysis-history-backup.service \
  /etc/systemd/system/hoi4-analysis-history-backup.service
sudo install -m 0644 deploy/private-alpha/hoi4-offsite-backup.service \
  /etc/systemd/system/hoi4-offsite-backup.service

sudo systemd-analyze verify \
  /etc/systemd/system/hoi4-monitor-failure@.service \
  /etc/systemd/system/hoi4-postgres-backup.service \
  /etc/systemd/system/hoi4-analysis-history-backup.service \
  /etc/systemd/system/hoi4-offsite-backup.service
sudo systemctl daemon-reload
```

Do not paste heartbeat URLs into unit files, command lines, shell history, or
journal messages. The environment file must stay `root:root` mode `0600`.
Leaving one URL empty is a safe temporary state: that job still records local
success and remains successful, but no external dead-man exists for it.

Initialize each Better Stack monitor only with a real, fully successful job:

```bash
sudo systemctl start hoi4-postgres-backup.service
sudo systemctl start hoi4-analysis-history-backup.service
sudo systemctl start hoi4-offsite-backup.service

sudo systemctl --no-pager --full status \
  hoi4-postgres-backup.service \
  hoi4-analysis-history-backup.service \
  hoi4-offsite-backup.service
sudo journalctl --since today \
  -u hoi4-postgres-backup.service \
  -u hoi4-analysis-history-backup.service \
  -u hoi4-offsite-backup.service \
  -u 'hoi4-monitor-failure@*'
sudo ls -la /var/lib/hoi4-save-tracker-monitor

sudo systemctl enable --now \
  hoi4-postgres-backup.timer \
  hoi4-analysis-history-backup.timer \
  hoi4-offsite-backup.timer
```

Expect exactly `postgres.last-success`, `analysis-history.last-success`, and
`offsite.last-success`, each mode `0600`, after the three successful runs. The
helper uses a two-second connect timeout and five-second total timeout. Provider
or network failure is only a sanitized warning; it never deletes a valid
generation, retries the backup, leaves the backend stopped, or converts a
successful backup service into failure.

To verify immediate failure delivery, schedule a deliberate provider alert
during a maintenance/test window rather than corrupting a production backup:

```bash
sudo systemctl start \
  hoi4-monitor-failure@hoi4-postgres-backup.service
sudo journalctl -u \
  hoi4-monitor-failure@hoi4-postgres-backup.service --since today
```

That command intentionally reports failure for the PostgreSQL heartbeat. Verify
the incident/email, then run the real PostgreSQL backup service successfully to
send recovery. Never include backup output in the provider event. A disabled
timer, failed notifier, lost network, or dead VPS is still detected by the
independent missed-heartbeat deadline.

### Recover from R2 after loss of the VPS

On isolated/new infrastructure, list the two remote prefixes and choose compatible PostgreSQL and history generations from nearby timestamps. The 02:30 and 02:40 artifacts are not an atomic cross-storage snapshot:

```bash
RECOVERY_DIR=$(mktemp -d /var/tmp/hoi4-r2-recovery.XXXXXX)
RCLONE_CONFIG=/path/to/recovery-rclone.conf

rclone copyto --config "$RCLONE_CONFIG" \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/postgres/hoi4_TIMESTAMP.dump \
  "$RECOVERY_DIR/hoi4_TIMESTAMP.dump"
rclone copyto --config "$RCLONE_CONFIG" \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/postgres/hoi4_TIMESTAMP.dump.sha256 \
  "$RECOVERY_DIR/hoi4_TIMESTAMP.dump.sha256"
rclone copyto --config "$RCLONE_CONFIG" \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/analysis-history/analysis-history_TIMESTAMP.tar.gz \
  "$RECOVERY_DIR/analysis-history_TIMESTAMP.tar.gz"
rclone copyto --config "$RCLONE_CONFIG" \
  hoi4-r2:hoi4-save-tracker-backups/private-alpha/analysis-history/analysis-history_TIMESTAMP.tar.gz.sha256 \
  "$RECOVERY_DIR/analysis-history_TIMESTAMP.tar.gz.sha256"

cd "$RECOVERY_DIR"
sha256sum --check hoi4_TIMESTAMP.dump.sha256
sha256sum --check analysis-history_TIMESTAMP.tar.gz.sha256
docker run --rm -i postgres:17-alpine pg_restore --list \
  < hoi4_TIMESTAMP.dump > /dev/null
tar -tzf analysis-history_TIMESTAMP.tar.gz > /dev/null
```

Continue with the existing isolated PostgreSQL and analysis-history restore-verification procedures above. Validate both artifacts on new infrastructure before an intentional production recovery. **Never use the first R2 download as a reason to overwrite live production data.** A complete application recovery requires both a compatible PostgreSQL backup and an `analysis-history` backup.

## Manual full-data backup

A usable backup requires **both** PostgreSQL and `analysis-history`: the database contains identity/ownership while the filesystem volume contains the deduplicated results and related metadata. Back them up during a short private-alpha maintenance window so the two snapshots correspond.

Create a root-owned directory outside the repository, stop public/application writes, dump PostgreSQL, archive the artifact volume, then resume services:

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
sudo install -d -m 700 "/srv/hoi4-backups/$STAMP"

docker compose --env-file .env.private-alpha -f docker-compose.yml -f docker-compose.private-alpha.yml stop edge frontend backend

docker compose --env-file .env.private-alpha -f docker-compose.yml -f docker-compose.private-alpha.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "/srv/hoi4-backups/$STAMP/postgres.dump"

docker compose --env-file .env.private-alpha -f docker-compose.yml -f docker-compose.private-alpha.yml run --rm --no-deps \
  -v "/srv/hoi4-backups/$STAMP:/backup" \
  backend sh -c 'tar -C /app/data -czf /backup/analysis-history.tar.gz .'

docker compose --env-file .env.private-alpha -f docker-compose.yml -f docker-compose.private-alpha.yml up -d
```

Record checksums and copy the backup off the VPS. The ignored `.env.private-alpha` is also required to operate the deployment and should be stored separately in an appropriately protected secret backup.

For a full-data restore, use a maintenance window and fresh or explicitly emptied target volumes: start PostgreSQL only, restore `postgres.dump` with `pg_restore`, restore `analysis-history.tar.gz` into the empty `analysis-history` volume, run the migration service, then start the full profile. Preserve the original backup until account login, ownership, share links and reopened results have all been checked. Rehearse this sequence on a disposable VPS before relying on it.

## Private-alpha boundaries

This profile does not provide per-user quotas, abuse/rate controls, an application registration allowlist, atomic cross-store snapshots, an off-site retention policy, restore orchestration, multi-instance coordination, distributed locking, readiness alerts or public-beta operations. Basic Auth is a temporary outer gate for trusted testers; public share URLs are also gated. Keep registration details and the outer credential within the invited group.
