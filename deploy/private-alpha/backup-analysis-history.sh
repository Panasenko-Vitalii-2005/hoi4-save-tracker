#!/usr/bin/env bash

set -euo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${HOI4_PROJECT_DIR:-$(cd -- "$SCRIPT_DIR/../.." && pwd)}"
ENV_FILE="${HOI4_PRIVATE_ALPHA_ENV_FILE:-$PROJECT_DIR/.env.private-alpha}"
BACKUP_DIR="${HOI4_ANALYSIS_HISTORY_BACKUP_DIR:-/var/backups/hoi4-save-tracker/analysis-history}"
RETENTION="${HOI4_ANALYSIS_HISTORY_BACKUP_RETENTION:-7}"
HEARTBEAT_BIN="${HOI4_MONITOR_HEARTBEAT_BIN:-/usr/local/sbin/hoi4-save-tracker-heartbeat}"

if [[ ! "$RETENTION" =~ ^[1-9][0-9]*$ ]]; then
  echo "HOI4_ANALYSIS_HISTORY_BACKUP_RETENTION must be a positive integer." >&2
  exit 2
fi

if [[ "$BACKUP_DIR" != /* || "$BACKUP_DIR" == "/" ]]; then
  echo "HOI4_ANALYSIS_HISTORY_BACKUP_DIR must be an absolute directory other than /." >&2
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
BACKUP_DIR="$(cd -- "$BACKUP_DIR" && pwd -P)"

exec 9>"$BACKUP_DIR/.backup.lock"
if ! flock -n 9; then
  echo "Another analysis-history backup is already running." >&2
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
filename="analysis-history_${timestamp}.tar.gz"
final_archive="$BACKUP_DIR/$filename"
final_checksum="$final_archive.sha256"

if [[ -e "$final_archive" || -e "$final_checksum" ]]; then
  echo "An analysis-history backup generation with the current timestamp already exists." >&2
  exit 1
fi

temporary_archive="$(mktemp --tmpdir="$BACKUP_DIR" ".${filename}.tmp.XXXXXX")"
temporary_checksum=""
temporary_listing=""
pair_complete=false
backend_stopped_by_script=false

send_success_heartbeat() {
  if [[ "$HEARTBEAT_BIN" == /* && -x "$HEARTBEAT_BIN" ]]; then
    if ! "$HEARTBEAT_BIN" success analysis-history; then
      echo "Analysis-history backup succeeded, but its monitoring heartbeat failed." >&2
    fi
  else
    echo "Analysis-history backup succeeded, but its monitoring heartbeat helper is unavailable." >&2
  fi
  return 0
}

restart_backend_if_needed() {
  if [[ "$backend_stopped_by_script" != true ]]; then
    return 0
  fi

  echo "Restarting backend after analysis-history snapshot."
  if ! "${compose[@]}" start backend; then
    return 1
  fi

  if [[ -z "$("${compose[@]}" ps --status running --quiet backend)" ]]; then
    echo "Backend did not return to the running state." >&2
    return 1
  fi

  backend_stopped_by_script=false
}

cleanup() {
  status=$?
  trap - EXIT INT TERM HUP

  if ! restart_backend_if_needed; then
    echo "Failed to restore the backend's prior running state." >&2
    status=1
  fi

  [[ -n "$temporary_listing" && -e "$temporary_listing" ]] && rm -f -- "$temporary_listing"
  [[ -n "$temporary_checksum" && -e "$temporary_checksum" ]] && rm -f -- "$temporary_checksum"
  [[ -n "$temporary_archive" && -e "$temporary_archive" ]] && rm -f -- "$temporary_archive"

  if [[ "$pair_complete" != true ]]; then
    [[ -e "$final_checksum" ]] && rm -f -- "$final_checksum"
    [[ -e "$final_archive" ]] && rm -f -- "$final_archive"
  fi

  if (( status == 0 )); then
    send_success_heartbeat
  fi

  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

backend_container_ids="$("${compose[@]}" ps --all --quiet backend)"
if [[ "$backend_container_ids" == *$'\n'* ]]; then
  echo "The Private Alpha backup supports exactly one backend container." >&2
  exit 1
fi

if [[ -n "$("${compose[@]}" ps --status running --quiet backend)" ]]; then
  backend_stopped_by_script=true
  echo "Stopping backend briefly for a consistent analysis-history snapshot."
  "${compose[@]}" stop backend

  if [[ -n "$("${compose[@]}" ps --status running --quiet backend)" ]]; then
    echo "Backend is still running; refusing to archive a writable volume." >&2
    exit 1
  fi
fi

"${compose[@]}" run --rm --no-deps -T --entrypoint sh backend -eu -c \
  'cd /app/data && exec tar -czf - .' \
  > "$temporary_archive"

restart_backend_if_needed

if [[ ! -s "$temporary_archive" ]]; then
  echo "The analysis-history archive is empty." >&2
  exit 1
fi

temporary_listing="$(mktemp --tmpdir="$BACKUP_DIR" ".${filename}.listing.XXXXXX")"
tar -tzf "$temporary_archive" > "$temporary_listing"

if grep -Eq '(^|/)\.\.(/|$)|^/' "$temporary_listing"; then
  echo "The analysis-history archive contains an unsafe path." >&2
  exit 1
fi

validation_command='
  validation_dir="$(mktemp -d)"
  cleanup_validation() {
    rm -rf -- "$validation_dir"
  }
  trap cleanup_validation EXIT INT TERM HUP
  tar -xzf - -C "$validation_dir"
  node -e "
    const fs = require(\"node:fs\");
    const path = require(\"node:path\");
    const zlib = require(\"node:zlib\");
    const root = process.argv[1];

    for (const name of [\"recent-analyses.json\", \"shared-analyses.json\"]) {
      JSON.parse(fs.readFileSync(path.join(root, name), \"utf8\"));
    }

    const resultsDirectory = path.join(root, \"analysis-results\");
    if (!fs.statSync(resultsDirectory).isDirectory()) {
      throw new Error(\"analysis-results is not a directory\");
    }

    const resultFiles = fs.readdirSync(resultsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(\".json.gz\"))
      .map((entry) => entry.name)
      .sort();

    for (const name of resultFiles) {
      const compressed = fs.readFileSync(path.join(resultsDirectory, name));
      JSON.parse(zlib.gunzipSync(compressed).toString(\"utf8\"));
    }

    process.stdout.write(String(resultFiles.length));
  " "$validation_dir"
'

result_count="$(
  "${compose[@]}" run --rm --no-deps -T --entrypoint sh backend -eu -c "$validation_command" \
    < "$temporary_archive"
)"

if [[ ! "$result_count" =~ ^[0-9]+$ ]]; then
  echo "Could not determine the validated analysis result count." >&2
  exit 1
fi

chmod 0600 -- "$temporary_archive"
mv -- "$temporary_archive" "$final_archive"
temporary_archive=""

checksum_value="$(sha256sum -- "$final_archive" | cut -d ' ' -f 1)"
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
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'analysis-history_*.tar.gz' -printf '%f\0' | sort -z -r
)

successful_generation=0
for backup_name in "${backup_names[@]}"; do
  if [[ ! "$backup_name" =~ ^analysis-history_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.tar\.gz$ ]]; then
    continue
  fi

  archive_path="$BACKUP_DIR/$backup_name"
  checksum_path="$archive_path.sha256"
  if [[ ! -f "$checksum_path" ]]; then
    continue
  fi

  ((successful_generation += 1))
  if (( successful_generation > RETENTION )); then
    rm -- "$archive_path" "$checksum_path"
  fi
done

echo "Analysis-history backup completed: $final_archive ($result_count result files validated)"
