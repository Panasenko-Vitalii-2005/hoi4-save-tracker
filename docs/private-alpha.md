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

## Manual backup

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

For restore, use a maintenance window and fresh or explicitly emptied target volumes: start PostgreSQL only, restore `postgres.dump` with `pg_restore`, restore `analysis-history.tar.gz` into the empty `analysis-history` volume, run the migration service, then start the full profile. Preserve the original backup until account login, ownership, share links and reopened results have all been checked. Rehearse this sequence on a disposable VPS before relying on it.

## Private-alpha boundaries

This profile does not provide per-user quotas, abuse/rate controls, an application registration allowlist, automated backups, restore orchestration, multi-instance coordination, distributed locking, readiness alerts or public-beta operations. Basic Auth is a temporary outer gate for trusted testers; public share URLs are also gated. Keep registration details and the outer credential within the invited group.
