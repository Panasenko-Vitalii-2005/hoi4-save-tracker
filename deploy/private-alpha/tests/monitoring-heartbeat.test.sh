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
export HOI4_MONITOR_HOST_HEALTH_HEARTBEAT_URL='https://uptime.betterstack.com/api/v1/heartbeat/host-token'
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
"$HEARTBEAT_SCRIPT" success host-health > /dev/null
grep -Fxq 'https://uptime.betterstack.com/api/v1/heartbeat/history-token' "$FAKE_CURL_LOG"
grep -Fxq 'https://uptime.betterstack.com/api/v1/heartbeat/offsite-token' "$FAKE_CURL_LOG"
grep -Fxq 'https://uptime.betterstack.com/api/v1/heartbeat/host-token' "$FAKE_CURL_LOG"
test -s "$TEST_ROOT/state/analysis-history.last-success"
test -s "$TEST_ROOT/state/offsite.last-success"
test -s "$TEST_ROOT/state/host-health.last-success"

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

host_secret_url='https://uptime.betterstack.com/api/v1/heartbeat/do-not-print-host-token'
export HOI4_MONITOR_HOST_HEALTH_HEARTBEAT_URL="$host_secret_url"
export FAKE_CURL_FAIL=true
if "$HEARTBEAT_SCRIPT" failure hoi4-host-health.service > "$TEST_ROOT/host-failure.out" 2> "$TEST_ROOT/host-failure.err"; then
  echo "A failed host heartbeat transport unexpectedly returned success." >&2
  exit 1
fi
if grep -Fq 'do-not-print-host-token' "$TEST_ROOT/host-failure.out" "$TEST_ROOT/host-failure.err"; then
  echo "A host heartbeat secret leaked into helper output." >&2
  exit 1
fi
grep -Fq 'delivery failed for host-health' "$TEST_ROOT/host-failure.err"
unset FAKE_CURL_FAIL
export HOI4_MONITOR_HOST_HEALTH_HEARTBEAT_URL='https://uptime.betterstack.com/api/v1/heartbeat/host-token'

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

escaped_host_instance='hoi4-monitor-failure@hoi4\x2dhost\x2dhealth.service.service'
escaped_host_subject='hoi4-host-health.service'
literal_host_subject='hoi4/host/health.service'
if command -v systemd-escape > /dev/null 2>&1; then
  escaped_host_instance="$(systemd-escape \
    --template=hoi4-monitor-failure@.service \
    'hoi4-host-health.service')"
  escaped_host_subject="$(systemd-escape \
    --unescape \
    --template=hoi4-monitor-failure@.service \
    "$escaped_host_instance")"
  literal_host_subject="$(systemd-escape \
    --unescape \
    --template=hoi4-monitor-failure@.service \
    'hoi4-monitor-failure@hoi4-host-health.service.service')"
fi
[[ "$escaped_host_instance" == 'hoi4-monitor-failure@hoi4\x2dhost\x2dhealth.service.service' ]]
[[ "$escaped_host_subject" == 'hoi4-host-health.service' ]]
[[ "$literal_host_subject" == 'hoi4/host/health.service' ]]
if "$HEARTBEAT_SCRIPT" failure "$literal_host_subject" > /dev/null 2> "$TEST_ROOT/slash-subject.err"; then
  echo "The path-unescaped host-health subject unexpectedly passed the allowlist." >&2
  exit 1
fi
grep -Fq 'not allowlisted' "$TEST_ROOT/slash-subject.err"

for failure_case in \
  'hoi4-postgres-backup.service|postgres|postgres-token' \
  'hoi4-analysis-history-backup.service|analysishistory|history-token' \
  'hoi4-offsite-backup.service|offsite|offsite-token' \
  'hoi4-host-health.service|hosthealth|host-token'; do
  IFS='|' read -r unit subject token <<< "$failure_case"
  unit_file="$SCRIPT_DIR/../$unit"
  failure_url="https://uptime.betterstack.com/api/v1/heartbeat/$token/fail"
  before_failure="$(grep -Fxc "$failure_url" "$FAKE_CURL_LOG" || true)"

  grep -Fxq "OnFailure=hoi4-monitor-failure@$subject.service" "$unit_file"
  grep -Fxq 'EnvironmentFile=-/etc/hoi4-save-tracker/monitoring.env' "$SCRIPT_DIR/../$unit"
  "$HEARTBEAT_SCRIPT" failure "$subject" > /dev/null

  after_failure="$(grep -Fxc "$failure_url" "$FAKE_CURL_LOG" || true)"
  if [[ "$after_failure" -ne $((before_failure + 1)) ]]; then
    echo "Failure subject $subject did not reach the heartbeat for $unit." >&2
    exit 1
  fi
done
grep -Fxq 'TimeoutStartSec=30min' "$SCRIPT_DIR/../hoi4-postgres-backup.service"
grep -Fxq 'TimeoutStartSec=60min' "$SCRIPT_DIR/../hoi4-analysis-history-backup.service"
grep -Fxq 'TimeoutStartSec=120min' "$SCRIPT_DIR/../hoi4-offsite-backup.service"
grep -Fxq 'TimeoutStartSec=2min' "$SCRIPT_DIR/../hoi4-host-health.service"
grep -Fxq 'Description=Report failure of HoI4 Save Tracker monitor %i' \
  "$SCRIPT_DIR/../hoi4-monitor-failure@.service"
grep -Fxq 'ExecStart=-/usr/local/sbin/hoi4-save-tracker-heartbeat failure %i' \
  "$SCRIPT_DIR/../hoi4-monitor-failure@.service"
if grep -Fq '%I' "$SCRIPT_DIR/../hoi4-monitor-failure@.service"; then
  echo "The failure template still path-unescapes its instance with %I." >&2
  exit 1
fi
if grep -Eq '^OnFailure=' "$SCRIPT_DIR/../hoi4-monitor-failure@.service"; then
  echo "The best-effort failure reporter must not recurse through OnFailure." >&2
  exit 1
fi

PRIVATE_ALPHA_DOC="$SCRIPT_DIR/../../../docs/private-alpha.md"
grep -Fxq 'FAILURE_UNIT=hoi4-monitor-failure@postgres.service' "$PRIVATE_ALPHA_DOC"
grep -Fq 'sudo systemctl start "$FAILURE_UNIT"' "$PRIVATE_ALPHA_DOC"
if grep -Fq -- '--template=hoi4-monitor-failure@.service' "$PRIVATE_ALPHA_DOC"; then
  echo "The controlled failure still derives an ambiguous instance from a unit name." >&2
  exit 1
fi

echo "monitoring heartbeat helper tests: PASS"
