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

The PostgreSQL dump covers users, sessions, analysis ownership and schema-migration state. The separate `analysis-history` volume contains compressed AnalyzeResult artifacts, Recent metadata and share metadata; it requires a separate coordinated backup. **A PostgreSQL backup alone is not complete application disaster recovery.**

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

This profile does not provide per-user quotas, abuse/rate controls, an application registration allowlist, automated `analysis-history` backups, off-server backup replication, restore orchestration, multi-instance coordination, distributed locking, readiness alerts or public-beta operations. Basic Auth is a temporary outer gate for trusted testers; public share URLs are also gated. Keep registration details and the outer credential within the invited group.
