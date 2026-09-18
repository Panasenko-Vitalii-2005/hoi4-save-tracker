#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPLICATION_SCRIPT="$(cd -- "$SCRIPT_DIR/.." && pwd)/replicate-backups-offsite.sh"
REAL_SHA256SUM="$(command -v sha256sum)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/hoi4-offsite-test.XXXXXX")"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/hoi4-offsite-test.*)
      if [[ -d "$TEST_ROOT" && ! -L "$TEST_ROOT" ]]; then
        rm -rf -- "$TEST_ROOT"
      fi
      ;;
    *)
      echo "Refusing to remove unexpected test directory: $TEST_ROOT" >&2
      exit 1
      ;;
  esac
}
trap cleanup EXIT INT TERM HUP

mkdir -p \
  "$TEST_ROOT/bin" \
  "$TEST_ROOT/postgres" \
  "$TEST_ROOT/analysis-history" \
  "$TEST_ROOT/remote" \
  "$TEST_ROOT/work"

cat > "$TEST_ROOT/bin/rclone" <<'FAKE_RCLONE'
#!/usr/bin/env bash

set -euo pipefail

command_name="${1:-}"
shift || true

if [[ "$command_name" == "version" ]]; then
  printf 'rclone v1.75.1\n'
  exit 0
fi

if [[ "${FAKE_RCLONE_FAIL:-false}" == true ]]; then
  exit 69
fi

if [[ "$command_name" != "copyto" || $# -lt 2 ]]; then
  exit 64
fi

source_path="$1"
destination_path="$2"

remote_path() {
  printf '%s/%s' "$FAKE_RCLONE_ROOT" "${1#*:}"
}

if [[ "$destination_path" == *:* ]]; then
  resolved_destination="$(remote_path "$destination_path")"
  mkdir -p -- "$(dirname -- "$resolved_destination")"
  cp -- "$source_path" "$resolved_destination"
  printf 'upload %s\n' "$destination_path" >> "$FAKE_RCLONE_LOG"
  printf 'rclone upload\n' >> "$FAKE_EVENT_LOG"
  exit 0
fi

resolved_source="$(remote_path "$source_path")"
if [[ ! -f "$resolved_source" ]]; then
  printf 'missing-download-success %s\n' "$source_path" >> "$FAKE_RCLONE_LOG"
  printf 'rclone missing-download\n' >> "$FAKE_EVENT_LOG"
  rm -f -- "$destination_path"
  exit 0
fi

mkdir -p -- "$(dirname -- "$destination_path")"
cp -- "$resolved_source" "$destination_path"
printf 'download %s\n' "$source_path" >> "$FAKE_RCLONE_LOG"
printf 'rclone download\n' >> "$FAKE_EVENT_LOG"
FAKE_RCLONE

cat > "$TEST_ROOT/bin/heartbeat" <<'FAKE_HEARTBEAT'
#!/usr/bin/env bash

set -euo pipefail

printf '%s %s\n' "$1" "$2" >> "$FAKE_HEARTBEAT_LOG"
printf 'heartbeat %s %s\n' "$1" "$2" >> "$FAKE_EVENT_LOG"
if [[ "${FAKE_HEARTBEAT_FAIL:-false}" == true ]]; then
  exit 1
fi
FAKE_HEARTBEAT

cat > "$TEST_ROOT/bin/sha256sum" <<'TRACKED_SHA256'
#!/usr/bin/env bash

set -euo pipefail

last_argument=""
for argument in "$@"; do
  last_argument="$argument"
done

if [[ -n "$last_argument" && "$last_argument" != "-" && ! -f "$last_argument" ]]; then
  printf '%s\n' "$last_argument" >> "$SHA256_MISSING_FILE_LOG"
fi

exec "$REAL_SHA256SUM" "$@"
TRACKED_SHA256

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    cat > "$TEST_ROOT/bin/install" <<'TEST_INSTALL'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p -- "${!#}"
TEST_INSTALL
    cat > "$TEST_ROOT/bin/chmod" <<'TEST_CHMOD'
#!/usr/bin/env bash
exit 0
TEST_CHMOD
    cat > "$TEST_ROOT/bin/flock" <<'TEST_FLOCK'
#!/usr/bin/env bash
exit 0
TEST_FLOCK
    ;;
esac

chmod +x "$TEST_ROOT/bin/"*

create_pair() {
  local directory="$1"
  local filename="$2"
  local content="$3"
  local hash

  printf '%s\n' "$content" > "$directory/$filename"
  hash="$("$REAL_SHA256SUM" -- "$directory/$filename" | cut -d ' ' -f 1)"
  printf '%s  %s\n' "$hash" "$filename" > "$directory/$filename.sha256"
}

create_pair "$TEST_ROOT/postgres" "hoi4_2026-09-17_023000.dump" "postgres fixture"
create_pair \
  "$TEST_ROOT/analysis-history" \
  "analysis-history_2026-09-17_024000.tar.gz" \
  "analysis-history fixture"
touch \
  "$TEST_ROOT/rclone.conf" \
  "$TEST_ROOT/rclone.log" \
  "$TEST_ROOT/sha256-missing.log" \
  "$TEST_ROOT/heartbeat.log" \
  "$TEST_ROOT/event.log"

export PATH="$TEST_ROOT/bin:/usr/bin:$PATH"
export REAL_SHA256SUM
export SHA256_MISSING_FILE_LOG="$TEST_ROOT/sha256-missing.log"
export FAKE_RCLONE_ROOT="$TEST_ROOT/remote"
export FAKE_RCLONE_LOG="$TEST_ROOT/rclone.log"
export FAKE_EVENT_LOG="$TEST_ROOT/event.log"
export FAKE_HEARTBEAT_LOG="$TEST_ROOT/heartbeat.log"
export HOI4_OFFSITE_POSTGRES_BACKUP_DIR="$TEST_ROOT/postgres"
export HOI4_OFFSITE_ANALYSIS_HISTORY_BACKUP_DIR="$TEST_ROOT/analysis-history"
export HOI4_OFFSITE_WORK_DIR="$TEST_ROOT/work"
export HOI4_OFFSITE_RCLONE_BIN="$TEST_ROOT/bin/rclone"
export HOI4_OFFSITE_RCLONE_CONFIG="$TEST_ROOT/rclone.conf"
export HOI4_OFFSITE_RCLONE_REMOTE="fake"
export HOI4_OFFSITE_BUCKET="hoi4-save-tracker-backups"
export HOI4_OFFSITE_PREFIX="private-alpha"
export HOI4_MONITOR_HEARTBEAT_BIN="$TEST_ROOT/bin/heartbeat"

stdout_log="$TEST_ROOT/stdout.log"
stderr_log="$TEST_ROOT/stderr.log"
"$REPLICATION_SCRIPT" > "$stdout_log" 2> "$stderr_log"

if [[ -s "$SHA256_MISSING_FILE_LOG" ]]; then
  echo "sha256sum was invoked for a nonexistent file." >&2
  cat "$SHA256_MISSING_FILE_LOG" >&2
  exit 1
fi

if grep -Fq "No such file or directory" "$stderr_log"; then
  echo "Replication emitted a misleading missing-file error." >&2
  cat "$stderr_log" >&2
  exit 1
fi

if [[ "$(grep -c '^missing-download-success ' "$FAKE_RCLONE_LOG")" -ne 4 ]]; then
  echo "The fake rclone did not reproduce all missing remote objects." >&2
  exit 1
fi

if [[ "$(grep -c '^upload ' "$FAKE_RCLONE_LOG")" -ne 4 ]]; then
  echo "Replication did not repair all missing remote objects." >&2
  exit 1
fi

if [[ "$(find "$TEST_ROOT/remote" -type f | wc -l)" -ne 4 ]]; then
  echo "The repaired remote does not contain both complete pairs." >&2
  exit 1
fi

if [[ "$(find "$TEST_ROOT/work" -maxdepth 1 -name '.verify.*' | wc -l)" -ne 0 ]]; then
  echo "Temporary verification artifacts were not cleaned up." >&2
  exit 1
fi

grep -Fq "All retained local backup generations are verified off-site." "$stdout_log"

if [[ "$(grep -c '^success offsite$' "$FAKE_HEARTBEAT_LOG")" -ne 1 ]]; then
  echo "Successful off-site replication did not emit exactly one heartbeat." >&2
  exit 1
fi
if [[ "$(tail -n 1 "$FAKE_EVENT_LOG")" != 'heartbeat success offsite' ]]; then
  echo "Off-site heartbeat was emitted before remote verification completed." >&2
  exit 1
fi

export FAKE_RCLONE_FAIL=true
if "$REPLICATION_SCRIPT" > /dev/null 2> "$TEST_ROOT/replication-failure.err"; then
  echo "Forced off-site replication failure unexpectedly succeeded." >&2
  exit 1
fi
unset FAKE_RCLONE_FAIL
if [[ "$(grep -c '^success offsite$' "$FAKE_HEARTBEAT_LOG")" -ne 1 ]]; then
  echo "Failed off-site replication emitted a success heartbeat." >&2
  exit 1
fi

export FAKE_HEARTBEAT_FAIL=true
"$REPLICATION_SCRIPT" > /dev/null 2> "$TEST_ROOT/heartbeat-failure.err"
unset FAKE_HEARTBEAT_FAIL
grep -Fq 'replication succeeded, but its monitoring heartbeat failed' "$TEST_ROOT/heartbeat-failure.err"
if [[ "$(grep -c '^success offsite$' "$FAKE_HEARTBEAT_LOG")" -ne 2 ]]; then
  echo "Heartbeat transport failure was not attempted exactly once." >&2
  exit 1
fi

echo "replicate-backups-offsite missing destination regression: PASS"
