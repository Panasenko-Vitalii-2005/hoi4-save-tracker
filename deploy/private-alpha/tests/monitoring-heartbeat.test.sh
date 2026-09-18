#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HEARTBEAT_SCRIPT="$(cd -- "$SCRIPT_DIR/.." && pwd)/monitoring-heartbeat.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/hoi4-heartbeat-test.XXXXXX")"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/hoi4-heartbeat-test.*)
      [[ ! -d "$TEST_ROOT" || -L "$TEST_ROOT" ]] || rm -rf -- "$TEST_ROOT"
      ;;
    *)
      echo "Refusing to remove unexpected test directory: $TEST_ROOT" >&2
      exit 1
      ;;
  esac
}
trap cleanup EXIT INT TERM HUP

mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/state"
cat > "$TEST_ROOT/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >> "$FAKE_CURL_LOG"
if [[ "${FAKE_CURL_FAIL:-false}" == true ]]; then
  exit 22
fi
FAKE_CURL
chmod +x "$TEST_ROOT/bin/curl"

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
    chmod +x "$TEST_ROOT/bin/install" "$TEST_ROOT/bin/chmod"
    ;;
esac

export PATH="$TEST_ROOT/bin:/usr/bin:$PATH"
export HOI4_MONITOR_CURL_BIN="$TEST_ROOT/bin/curl"
export HOI4_MONITOR_STATE_DIR="$TEST_ROOT/state"
export HOI4_MONITOR_POSTGRES_HEARTBEAT_URL='https://uptime.betterstack.com/api/v1/heartbeat/postgres-token'
export HOI4_MONITOR_ANALYSIS_HISTORY_HEARTBEAT_URL='https://uptime.betterstack.com/api/v1/heartbeat/history-token'
export HOI4_MONITOR_OFFSITE_HEARTBEAT_URL='https://uptime.betterstack.com/api/v1/heartbeat/offsite-token'
export FAKE_CURL_LOG="$TEST_ROOT/curl.log"
touch "$FAKE_CURL_LOG"

if ! "$HEARTBEAT_SCRIPT" success postgres > "$TEST_ROOT/postgres.out" 2> "$TEST_ROOT/postgres.err"; then
  echo "PostgreSQL heartbeat helper invocation failed." >&2
  cat "$TEST_ROOT/postgres.err" >&2
  exit 1
fi
if [[ "$(grep -c '^https://uptime.betterstack.com/api/v1/heartbeat/postgres-token$' "$FAKE_CURL_LOG")" -ne 1 ]]; then
  echo "PostgreSQL success did not emit exactly one independent heartbeat." >&2
  exit 1
fi
if [[ ! -s "$TEST_ROOT/state/postgres.last-success" ]]; then
  echo "PostgreSQL success state was not recorded." >&2
  exit 1
fi

"$HEARTBEAT_SCRIPT" success analysis-history > /dev/null
"$HEARTBEAT_SCRIPT" success offsite > /dev/null
grep -Fxq 'https://uptime.betterstack.com/api/v1/heartbeat/history-token' "$FAKE_CURL_LOG"
grep -Fxq 'https://uptime.betterstack.com/api/v1/heartbeat/offsite-token' "$FAKE_CURL_LOG"
test -s "$TEST_ROOT/state/analysis-history.last-success"
test -s "$TEST_ROOT/state/offsite.last-success"

"$HEARTBEAT_SCRIPT" failure hoi4-postgres-backup.service > /dev/null
grep -Fxq 'https://uptime.betterstack.com/api/v1/heartbeat/postgres-token/fail' "$FAKE_CURL_LOG"

grep -Fxq -- '--connect-timeout' "$FAKE_CURL_LOG"
grep -Fxq -- '2' "$FAKE_CURL_LOG"
grep -Fxq -- '--max-time' "$FAKE_CURL_LOG"
grep -Fxq -- '5' "$FAKE_CURL_LOG"
grep -Fxq -- "=https" "$FAKE_CURL_LOG"

before_missing="$(wc -l < "$FAKE_CURL_LOG")"
unset HOI4_MONITOR_OFFSITE_HEARTBEAT_URL
"$HEARTBEAT_SCRIPT" success offsite > "$TEST_ROOT/missing.out" 2> "$TEST_ROOT/missing.err"
after_missing="$(wc -l < "$FAKE_CURL_LOG")"
if [[ "$before_missing" -ne "$after_missing" ]]; then
  echo "Missing heartbeat configuration unexpectedly invoked curl." >&2
  exit 1
fi
grep -Fq 'delivery skipped' "$TEST_ROOT/missing.err"

secret_url='https://uptime.betterstack.com/api/v1/heartbeat/do-not-print-this-token'
export HOI4_MONITOR_OFFSITE_HEARTBEAT_URL="$secret_url"
export FAKE_CURL_FAIL=true
if "$HEARTBEAT_SCRIPT" success offsite > "$TEST_ROOT/failure.out" 2> "$TEST_ROOT/failure.err"; then
  echo "A failed heartbeat transport unexpectedly returned success." >&2
  exit 1
fi
if grep -Fq 'do-not-print-this-token' "$TEST_ROOT/failure.out" "$TEST_ROOT/failure.err"; then
  echo "A secret heartbeat URL leaked into helper output." >&2
  exit 1
fi
grep -Fq 'delivery failed for offsite' "$TEST_ROOT/failure.err"
unset FAKE_CURL_FAIL

before_invalid="$(wc -l < "$FAKE_CURL_LOG")"
export HOI4_MONITOR_OFFSITE_HEARTBEAT_URL='http://uptime.betterstack.com/api/v1/heartbeat/insecure'
if "$HEARTBEAT_SCRIPT" success offsite > /dev/null 2> "$TEST_ROOT/invalid.err"; then
  echo "An insecure heartbeat URL was accepted." >&2
  exit 1
fi
after_invalid="$(wc -l < "$FAKE_CURL_LOG")"
if [[ "$before_invalid" -ne "$after_invalid" ]]; then
  echo "Invalid heartbeat configuration unexpectedly invoked curl." >&2
  exit 1
fi

if "$HEARTBEAT_SCRIPT" failure not-an-allowlisted-unit > /dev/null 2> "$TEST_ROOT/allowlist.err"; then
  echo "A non-allowlisted failure unit was accepted." >&2
  exit 1
fi
grep -Fq 'not allowlisted' "$TEST_ROOT/allowlist.err"

export HOI4_MONITOR_OFFSITE_HEARTBEAT_URL='https://uptime.betterstack.com/api/v1/heartbeat/offsite-token'

build_failure_instance() {
  local subject="$1"

  if command -v systemd-escape > /dev/null 2>&1; then
    systemd-escape --template=hoi4-monitor-failure@.service "$subject"
    return
  fi

  case "$subject" in
    hoi4-postgres-backup.service)
      printf '%s\n' 'hoi4-monitor-failure@hoi4\x2dpostgres\x2dbackup.service.service'
      ;;
    hoi4-analysis-history-backup.service)
      printf '%s\n' 'hoi4-monitor-failure@hoi4\x2danalysis\x2dhistory\x2dbackup.service.service'
      ;;
    hoi4-offsite-backup.service)
      printf '%s\n' 'hoi4-monitor-failure@hoi4\x2doffsite\x2dbackup.service.service'
      ;;
    *)
      return 2
      ;;
  esac
}

unescape_failure_instance() {
  local instance="$1"
  local expected_subject="$2"

  if command -v systemd-escape > /dev/null 2>&1; then
    systemd-escape --unescape --template=hoi4-monitor-failure@.service "$instance"
    return
  fi

  printf '%s\n' "$expected_subject"
}

for failure_case in \
  'hoi4-postgres-backup.service|hoi4-monitor-failure@hoi4\x2dpostgres\x2dbackup.service.service' \
  'hoi4-analysis-history-backup.service|hoi4-monitor-failure@hoi4\x2danalysis\x2dhistory\x2dbackup.service.service' \
  'hoi4-offsite-backup.service|hoi4-monitor-failure@hoi4\x2doffsite\x2dbackup.service.service'; do
  subject="${failure_case%%|*}"
  expected_instance="${failure_case#*|}"
  failure_instance="$(build_failure_instance "$subject")"
  if [[ "$failure_instance" != "$expected_instance" ]]; then
    echo "Unexpected OnFailure instance for $subject: $failure_instance" >&2
    exit 1
  fi

  final_subject="$(unescape_failure_instance "$failure_instance" "$subject")"
  if [[ "$final_subject" != "$subject" ]]; then
    echo "The failure template did not recover the original unit name for $subject." >&2
    exit 1
  fi
  "$HEARTBEAT_SCRIPT" failure "$final_subject" > /dev/null
done

for unit in \
  hoi4-postgres-backup.service \
  hoi4-analysis-history-backup.service \
  hoi4-offsite-backup.service; do
  grep -Fxq 'OnFailure=hoi4-monitor-failure@%n.service' "$SCRIPT_DIR/../$unit"
  grep -Fxq 'EnvironmentFile=-/etc/hoi4-save-tracker/monitoring.env' "$SCRIPT_DIR/../$unit"
done
grep -Fxq 'TimeoutStartSec=30min' "$SCRIPT_DIR/../hoi4-postgres-backup.service"
grep -Fxq 'TimeoutStartSec=60min' "$SCRIPT_DIR/../hoi4-analysis-history-backup.service"
grep -Fxq 'TimeoutStartSec=120min' "$SCRIPT_DIR/../hoi4-offsite-backup.service"
grep -Fxq 'Description=Report failure of HoI4 Save Tracker backup unit %I' \
  "$SCRIPT_DIR/../hoi4-monitor-failure@.service"
grep -Fxq 'ExecStart=-/usr/local/sbin/hoi4-save-tracker-heartbeat failure %I' \
  "$SCRIPT_DIR/../hoi4-monitor-failure@.service"
if grep -Fq 'failure %i' "$SCRIPT_DIR/../hoi4-monitor-failure@.service"; then
  echo "The failure template still passes the escaped %i instance." >&2
  exit 1
fi

PRIVATE_ALPHA_DOC="$SCRIPT_DIR/../../../docs/private-alpha.md"
grep -Fq 'FAILURE_UNIT="$(systemd-escape \' "$PRIVATE_ALPHA_DOC"
grep -Fq -- '--template=hoi4-monitor-failure@.service \' "$PRIVATE_ALPHA_DOC"
grep -Fq "'hoi4-postgres-backup.service')\"" "$PRIVATE_ALPHA_DOC"
grep -Fq 'sudo systemctl start "$FAILURE_UNIT"' "$PRIVATE_ALPHA_DOC"

echo "monitoring heartbeat helper tests: PASS"
