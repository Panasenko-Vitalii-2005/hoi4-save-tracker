#!/usr/bin/env bash

set -euo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${HOI4_PROJECT_DIR:-$(cd -- "$SCRIPT_DIR/../.." && pwd)}"
ENV_FILE="${HOI4_PRIVATE_ALPHA_ENV_FILE:-$PROJECT_DIR/.env.private-alpha}"
BACKUP_DIR="${HOI4_POSTGRES_BACKUP_DIR:-/var/backups/hoi4-save-tracker/postgres}"
RETENTION="${HOI4_POSTGRES_BACKUP_RETENTION:-7}"
HEARTBEAT_BIN="${HOI4_MONITOR_HEARTBEAT_BIN:-/usr/local/sbin/hoi4-save-tracker-heartbeat}"

if [[ ! "$RETENTION" =~ ^[1-9][0-9]*$ ]]; then
  echo "HOI4_POSTGRES_BACKUP_RETENTION must be a positive integer." >&2
  exit 2
fi

if [[ "$BACKUP_DIR" != /* || "$BACKUP_DIR" == "/" ]]; then
  echo "HOI4_POSTGRES_BACKUP_DIR must be an absolute directory other than /." >&2
  exit 2
fi

if [[ ! -f "$PROJECT_DIR/docker-compose.yml" || ! -f "$PROJECT_DIR/docker-compose.private-alpha.yml" ]]; then
  echo "Private Alpha Compose files were not found in HOI4_PROJECT_DIR." >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Private Alpha environment file was not found." >&2
  exit 2
fi

install -d -m 0700 -- "$BACKUP_DIR"
chmod 0700 -- "$BACKUP_DIR"

exec 9>"$BACKUP_DIR/.backup.lock"
if ! flock -n 9; then
  echo "Another PostgreSQL backup is already running." >&2
  exit 1
fi

compose=(
  docker compose
  --project-directory "$PROJECT_DIR"
  --env-file "$ENV_FILE"
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.private-alpha.yml"
)

timestamp="$(date '+%Y-%m-%d_%H%M%S')"
filename="hoi4_${timestamp}.dump"
final_dump="$BACKUP_DIR/$filename"
final_checksum="$final_dump.sha256"

if [[ -e "$final_dump" || -e "$final_checksum" ]]; then
  echo "A backup generation with the current timestamp already exists." >&2
  exit 1
fi

temporary_dump="$(mktemp --tmpdir="$BACKUP_DIR" ".${filename}.tmp.XXXXXX")"
temporary_checksum=""
pair_complete=false

send_success_heartbeat() {
  if [[ "$HEARTBEAT_BIN" == /* && -x "$HEARTBEAT_BIN" ]]; then
    if ! "$HEARTBEAT_BIN" success postgres; then
      echo "PostgreSQL backup succeeded, but its monitoring heartbeat failed." >&2
    fi
  else
    echo "PostgreSQL backup succeeded, but its monitoring heartbeat helper is unavailable." >&2
  fi
  return 0
}

cleanup() {
  status=$?
  trap - EXIT

  if [[ -n "$temporary_dump" && -e "$temporary_dump" ]]; then
    rm -f -- "$temporary_dump"
  fi
  if [[ -n "$temporary_checksum" && -e "$temporary_checksum" ]]; then
    rm -f -- "$temporary_checksum"
  fi
  if [[ "$pair_complete" != true ]]; then
    [[ -e "$final_checksum" ]] && rm -f -- "$final_checksum"
    [[ -e "$final_dump" ]] && rm -f -- "$final_dump"
  fi

  if (( status == 0 )); then
    send_success_heartbeat
  fi

  exit "$status"
}
trap cleanup EXIT

"${compose[@]}" exec -T postgres sh -eu -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump --format=custom --no-password --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  > "$temporary_dump"

if [[ ! -s "$temporary_dump" ]]; then
  echo "pg_dump produced an empty backup." >&2
  exit 1
fi

"${compose[@]}" exec -T postgres pg_restore --list < "$temporary_dump" > /dev/null

chmod 0600 -- "$temporary_dump"
mv -- "$temporary_dump" "$final_dump"
temporary_dump=""

checksum_value="$(sha256sum -- "$final_dump" | cut -d ' ' -f 1)"
if [[ ! "$checksum_value" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "Failed to generate a valid SHA-256 checksum." >&2
  exit 1
fi

temporary_checksum="$(mktemp --tmpdir="$BACKUP_DIR" ".${filename}.sha256.tmp.XXXXXX")"
printf '%s  %s\n' "$checksum_value" "$filename" > "$temporary_checksum"
chmod 0600 -- "$temporary_checksum"
mv -- "$temporary_checksum" "$final_checksum"
temporary_checksum=""
pair_complete=true

mapfile -d '' backup_names < <(
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'hoi4_*.dump' -printf '%f\0' | sort -z -r
)

successful_generation=0
for backup_name in "${backup_names[@]}"; do
  if [[ ! "$backup_name" =~ ^hoi4_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$ ]]; then
    continue
  fi

  backup_path="$BACKUP_DIR/$backup_name"
  checksum_path="$backup_path.sha256"
  if [[ ! -f "$checksum_path" ]]; then
    continue
  fi

  ((successful_generation += 1))
  if (( successful_generation > RETENTION )); then
    rm -- "$backup_path" "$checksum_path"
  fi
done

echo "PostgreSQL backup completed: $final_dump"
