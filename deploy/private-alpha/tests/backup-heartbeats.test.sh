#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/hoi4-backup-heartbeat-test.XXXXXX")"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/hoi4-backup-heartbeat-test.*)
      [[ ! -d "$TEST_ROOT" || -L "$TEST_ROOT" ]] || rm -rf -- "$TEST_ROOT"
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
  "$TEST_ROOT/project" \
  "$TEST_ROOT/history-source/analysis-results"
touch \
  "$TEST_ROOT/project/docker-compose.yml" \
  "$TEST_ROOT/project/docker-compose.private-alpha.yml" \
  "$TEST_ROOT/project/private.env"
printf '{}\n' > "$TEST_ROOT/history-source/recent-analyses.json"
printf '{}\n' > "$TEST_ROOT/history-source/shared-analyses.json"
printf 'fixture\n' > "$TEST_ROOT/history-source/analysis-results/result.json.gz"

cat > "$TEST_ROOT/bin/date" <<'FAKE_DATE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == '+%Y-%m-%d_%H%M%S' ]]; then
  printf '%s\n' "${FAKE_BACKUP_TIMESTAMP:?}"
  exit 0
fi
exec /usr/bin/date "$@"
FAKE_DATE

cat > "$TEST_ROOT/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
arguments="$*"

if [[ "$arguments" == *'ps --all --quiet backend'* ]]; then
  printf 'backend-id\n'
  exit 0
fi
if [[ "$arguments" == *'ps --status running --quiet backend'* ]]; then
  if [[ "$(<"$FAKE_BACKEND_STATE")" == running ]]; then
    printf 'backend-id\n'
  fi
  exit 0
fi
if [[ "$arguments" == *' stop backend'* ]]; then
  printf 'stopped\n' > "$FAKE_BACKEND_STATE"
  exit 0
fi
if [[ "$arguments" == *' start backend'* ]]; then
  printf 'running\n' > "$FAKE_BACKEND_STATE"
  exit 0
fi
if [[ "$arguments" == *'pg_dump --format=custom'* ]]; then
  printf 'postgres dump fixture\n'
  exit 0
fi
if [[ "$arguments" == *'pg_restore --list'* ]]; then
  cat > /dev/null
  [[ "${FAKE_DOCKER_FAIL:-}" != postgres-validation ]]
  exit
fi
if [[ "$arguments" == *'cd /app/data && exec tar -czf - .'* ]]; then
  if [[ "${FAKE_DOCKER_FAIL:-}" == history-archive ]]; then
    exit 1
  fi
  tar -czf - -C "$FAKE_HISTORY_SOURCE" .
  exit 0
fi
if [[ "$arguments" == *'validation_dir='* ]]; then
  cat > /dev/null
  printf '2\n'
  exit 0
fi

echo "Unexpected fake docker invocation." >&2
exit 64
FAKE_DOCKER

cat > "$TEST_ROOT/bin/heartbeat" <<'FAKE_HEARTBEAT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s %s\n' "$1" "$2" >> "$FAKE_HEARTBEAT_LOG"
if [[ "$2" == analysis-history && "$(<"$FAKE_BACKEND_STATE")" != running ]]; then
  echo 'Analysis-history heartbeat ran before backend restoration.' >&2
  exit 70
fi
if [[ "${FAKE_HEARTBEAT_FAIL:-false}" == true ]]; then
  exit 1
fi
FAKE_HEARTBEAT

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
export PATH="$TEST_ROOT/bin:/usr/bin:$PATH"
export HOI4_PROJECT_DIR="$TEST_ROOT/project"
export HOI4_PRIVATE_ALPHA_ENV_FILE="$TEST_ROOT/project/private.env"
export HOI4_MONITOR_HEARTBEAT_BIN="$TEST_ROOT/bin/heartbeat"
export FAKE_HEARTBEAT_LOG="$TEST_ROOT/heartbeat.log"
export FAKE_BACKEND_STATE="$TEST_ROOT/backend.state"
export FAKE_HISTORY_SOURCE="$TEST_ROOT/history-source"
touch "$FAKE_HEARTBEAT_LOG"

export HOI4_POSTGRES_BACKUP_DIR="$TEST_ROOT/postgres-success"
export FAKE_BACKUP_TIMESTAMP='2026-09-18_023000'
"$DEPLOY_DIR/backup-postgres.sh" > "$TEST_ROOT/postgres-success.out" 2> "$TEST_ROOT/postgres-success.err"
grep -Fxq 'success postgres' "$FAKE_HEARTBEAT_LOG"
test -s "$HOI4_POSTGRES_BACKUP_DIR/hoi4_2026-09-18_023000.dump"
test -s "$HOI4_POSTGRES_BACKUP_DIR/hoi4_2026-09-18_023000.dump.sha256"

postgres_heartbeat_count="$(grep -c '^success postgres$' "$FAKE_HEARTBEAT_LOG")"
export HOI4_POSTGRES_BACKUP_DIR="$TEST_ROOT/postgres-failure"
export FAKE_BACKUP_TIMESTAMP='2026-09-18_023100'
export FAKE_DOCKER_FAIL=postgres-validation
if "$DEPLOY_DIR/backup-postgres.sh" > /dev/null 2> "$TEST_ROOT/postgres-failure.err"; then
  echo "A failed PostgreSQL validation unexpectedly succeeded." >&2
  exit 1
fi
unset FAKE_DOCKER_FAIL
if [[ "$(grep -c '^success postgres$' "$FAKE_HEARTBEAT_LOG")" -ne "$postgres_heartbeat_count" ]]; then
  echo "A failed PostgreSQL backup emitted a success heartbeat." >&2
  exit 1
fi

export HOI4_POSTGRES_BACKUP_DIR="$TEST_ROOT/postgres-heartbeat-failure"
export FAKE_BACKUP_TIMESTAMP='2026-09-18_023200'
export FAKE_HEARTBEAT_FAIL=true
"$DEPLOY_DIR/backup-postgres.sh" > /dev/null 2> "$TEST_ROOT/postgres-heartbeat-failure.err"
unset FAKE_HEARTBEAT_FAIL
grep -Fq 'backup succeeded, but its monitoring heartbeat failed' "$TEST_ROOT/postgres-heartbeat-failure.err"

printf 'running\n' > "$FAKE_BACKEND_STATE"
export HOI4_ANALYSIS_HISTORY_BACKUP_DIR="$TEST_ROOT/history-success"
export FAKE_BACKUP_TIMESTAMP='2026-09-18_024000'
"$DEPLOY_DIR/backup-analysis-history.sh" > "$TEST_ROOT/history-success.out" 2> "$TEST_ROOT/history-success.err"
grep -Fxq 'success analysis-history' "$FAKE_HEARTBEAT_LOG"
grep -Fxq 'running' "$FAKE_BACKEND_STATE"
test -s "$HOI4_ANALYSIS_HISTORY_BACKUP_DIR/analysis-history_2026-09-18_024000.tar.gz"
test -s "$HOI4_ANALYSIS_HISTORY_BACKUP_DIR/analysis-history_2026-09-18_024000.tar.gz.sha256"

history_heartbeat_count="$(grep -c '^success analysis-history$' "$FAKE_HEARTBEAT_LOG")"
printf 'running\n' > "$FAKE_BACKEND_STATE"
export HOI4_ANALYSIS_HISTORY_BACKUP_DIR="$TEST_ROOT/history-failure"
export FAKE_BACKUP_TIMESTAMP='2026-09-18_024100'
export FAKE_DOCKER_FAIL=history-archive
if "$DEPLOY_DIR/backup-analysis-history.sh" > /dev/null 2> "$TEST_ROOT/history-failure.err"; then
  echo "A failed analysis-history archive unexpectedly succeeded." >&2
  exit 1
fi
unset FAKE_DOCKER_FAIL
grep -Fxq 'running' "$FAKE_BACKEND_STATE"
if [[ "$(grep -c '^success analysis-history$' "$FAKE_HEARTBEAT_LOG")" -ne "$history_heartbeat_count" ]]; then
  echo "A failed analysis-history backup emitted a success heartbeat." >&2
  exit 1
fi

printf 'running\n' > "$FAKE_BACKEND_STATE"
export HOI4_ANALYSIS_HISTORY_BACKUP_DIR="$TEST_ROOT/history-heartbeat-failure"
export FAKE_BACKUP_TIMESTAMP='2026-09-18_024200'
export FAKE_HEARTBEAT_FAIL=true
"$DEPLOY_DIR/backup-analysis-history.sh" > /dev/null 2> "$TEST_ROOT/history-heartbeat-failure.err"
unset FAKE_HEARTBEAT_FAIL
grep -Fxq 'running' "$FAKE_BACKEND_STATE"
grep -Fq 'backup succeeded, but its monitoring heartbeat failed' "$TEST_ROOT/history-heartbeat-failure.err"

echo "backup heartbeat integration tests: PASS"
