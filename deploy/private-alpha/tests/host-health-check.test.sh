#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
CHECKER="$DEPLOY_DIR/host-health-check.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/hoi4-host-health-test.XXXXXX")"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/hoi4-host-health-test.*)
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
  "$TEST_ROOT/postgres-backups" \
  "$TEST_ROOT/history-backups" \
  "$TEST_ROOT/state" \
  "$TEST_ROOT/docker-root" \
  "$TEST_ROOT/restarts"
touch \
  "$TEST_ROOT/project/docker-compose.yml" \
  "$TEST_ROOT/project/docker-compose.private-alpha.yml" \
  "$TEST_ROOT/project/private.env" \
  "$TEST_ROOT/heartbeat.log"

cat > "$TEST_ROOT/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == info ]]; then
  [[ "${FAKE_DOCKER_UNAVAILABLE:-false}" != true ]] || exit 1
  printf '26.1.0|%s\n' "$FAKE_DOCKER_ROOT"
  exit 0
fi

if [[ "${1:-}" == compose ]]; then
  [[ "${FAKE_COMPOSE_UNAVAILABLE:-false}" != true ]] || exit 1
  service_name="${!#}"
  if [[ "${FAKE_CONTAINER_PROBLEM:-}" == "$service_name:missing" ]]; then
    exit 0
  fi
  printf '%s-id\n' "$service_name"
  exit 0
fi

if [[ "${1:-}" == inspect ]]; then
  container_id="${!#}"
  service_name="${container_id%-id}"
  status=running
  health=healthy
  exit_code=0
  [[ "$service_name" != edge ]] || health=none
  if [[ "$service_name" == migrate ]]; then
    status=exited
    health=none
  fi
  case "${FAKE_CONTAINER_PROBLEM:-}" in
    "$service_name:stopped") status=exited ;;
    "$service_name:unhealthy") health=unhealthy ;;
    "$service_name:failed") status=exited; exit_code=1 ;;
  esac
  restart_count=0
  [[ ! -f "$FAKE_RESTART_DIR/$service_name" ]] || restart_count="$(<"$FAKE_RESTART_DIR/$service_name")"
  printf '%s|%s|%s|%s\n' "$status" "$health" "$restart_count" "$exit_code"
  exit 0
fi

exit 64
FAKE_DOCKER

cat > "$TEST_ROOT/bin/systemctl" <<'FAKE_SYSTEMCTL'
#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
timer_name="${!#}"
case "$command_name" in
  is-enabled)
    [[ "${FAKE_TIMER_PROBLEM:-}" != "$timer_name:disabled" ]] || exit 1
    exit 0
    ;;
  is-active)
    [[ "${FAKE_TIMER_PROBLEM:-}" != "$timer_name:inactive" ]] || exit 1
    exit 0
    ;;
  show)
    if [[ "${FAKE_TIMER_PROBLEM:-}" == "$timer_name:no-next" ]]; then
      printf 'n/a\n'
    else
      /usr/bin/date -u -d "@$((${HOI4_MONITOR_NOW_EPOCH:?} + 3600))" '+%Y-%m-%d %H:%M:%S UTC'
    fi
    exit 0
    ;;
esac

exit 64
FAKE_SYSTEMCTL

cat > "$TEST_ROOT/bin/df" <<'FAKE_DF'
#!/usr/bin/env bash
set -euo pipefail

if [[ " $* " == *' -Pi '* ]]; then
  printf 'Filesystem Inodes IUsed IFree IUse%% Mounted on\n'
  printf 'fakefs 100000 10000 90000 %s%% /\n' "${FAKE_INODE_USED_PERCENT:-10}"
else
  printf 'Filesystem 1-blocks Used Available Use%% Mounted on\n'
  printf 'fakefs 21474836480 2147483648 %s %s%% /\n' \
    "${FAKE_DISK_AVAILABLE_BYTES:-19327352832}" \
    "${FAKE_DISK_USED_PERCENT:-10}"
fi
FAKE_DF

cat > "$TEST_ROOT/bin/flock" <<'FAKE_FLOCK'
#!/usr/bin/env bash
exit 0
FAKE_FLOCK

cat > "$TEST_ROOT/bin/heartbeat" <<'FAKE_HEARTBEAT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s %s\n' "$1" "$2" >> "$FAKE_HEARTBEAT_LOG"
[[ "${FAKE_HEARTBEAT_FAIL:-false}" != true ]]
FAKE_HEARTBEAT

cat > "$TEST_ROOT/bin/install" <<'FAKE_INSTALL'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p -- "${!#}"
FAKE_INSTALL

cat > "$TEST_ROOT/bin/chmod" <<'FAKE_CHMOD'
#!/usr/bin/env bash
exit 0
FAKE_CHMOD

chmod +x "$TEST_ROOT/bin/"*
export PATH="$TEST_ROOT/bin:/usr/bin:$PATH"
export HOI4_MONITOR_PROJECT_DIR="$TEST_ROOT/project"
export HOI4_MONITOR_PRIVATE_ALPHA_ENV_FILE="$TEST_ROOT/project/private.env"
export HOI4_MONITOR_POSTGRES_BACKUP_DIR="$TEST_ROOT/postgres-backups"
export HOI4_MONITOR_ANALYSIS_HISTORY_BACKUP_DIR="$TEST_ROOT/history-backups"
export HOI4_MONITOR_STATE_DIR="$TEST_ROOT/state"
export HOI4_MONITOR_MEMINFO_PATH="$TEST_ROOT/meminfo"
export HOI4_MONITOR_DOCKER_BIN="$TEST_ROOT/bin/docker"
export HOI4_MONITOR_SYSTEMCTL_BIN="$TEST_ROOT/bin/systemctl"
export HOI4_MONITOR_DF_BIN="$TEST_ROOT/bin/df"
export HOI4_MONITOR_DATE_BIN=/usr/bin/date
export HOI4_MONITOR_FLOCK_BIN="$TEST_ROOT/bin/flock"
export HOI4_MONITOR_HEARTBEAT_BIN="$TEST_ROOT/bin/heartbeat"
export HOI4_MONITOR_NOW_EPOCH=2000000000
export HOI4_MONITOR_HOST_HEALTH_HEARTBEAT_URL='https://uptime.betterstack.com/api/v1/heartbeat/host-secret-token'
export FAKE_DOCKER_ROOT="$TEST_ROOT/docker-root"
export FAKE_RESTART_DIR="$TEST_ROOT/restarts"
export FAKE_HEARTBEAT_LOG="$TEST_ROOT/heartbeat.log"

grep -Fxq 'OnFailure=hoi4-monitor-failure@hosthealth.service' "$DEPLOY_DIR/hoi4-host-health.service"
grep -Fxq 'ExecStart=/usr/local/sbin/hoi4-save-tracker-host-health' "$DEPLOY_DIR/hoi4-host-health.service"
grep -Fxq 'TimeoutStartSec=2min' "$DEPLOY_DIR/hoi4-host-health.service"
grep -Fxq 'ReadWritePaths=/var/lib/hoi4-save-tracker-monitor' "$DEPLOY_DIR/hoi4-host-health.service"
if grep -Fq 'Requires=docker.service' "$DEPLOY_DIR/hoi4-host-health.service"; then
  echo "Host monitoring must not start Docker as a dependency." >&2
  exit 1
fi
grep -Fxq 'OnBootSec=10min' "$DEPLOY_DIR/hoi4-host-health.timer"
grep -Fxq 'OnUnitActiveSec=5min' "$DEPLOY_DIR/hoi4-host-health.timer"
grep -Fxq 'Unit=hoi4-host-health.service' "$DEPLOY_DIR/hoi4-host-health.timer"

write_markers() {
  local marker_time
  marker_time="$(/usr/bin/date -u -d "@$((HOI4_MONITOR_NOW_EPOCH - 3600))" '+%Y-%m-%dT%H:%M:%SZ')"
  printf '%s\n' "$marker_time" > "$TEST_ROOT/state/postgres.last-success"
  printf '%s\n' "$marker_time" > "$TEST_ROOT/state/analysis-history.last-success"
  printf '%s\n' "$marker_time" > "$TEST_ROOT/state/offsite.last-success"
}

write_memory() {
  local available_kib="$1"
  cat > "$TEST_ROOT/meminfo" <<EOF
MemTotal:       1000000 kB
MemAvailable:   $available_kib kB
EOF
}

reset_scenario() {
  unset FAKE_DOCKER_UNAVAILABLE FAKE_COMPOSE_UNAVAILABLE FAKE_CONTAINER_PROBLEM FAKE_TIMER_PROBLEM
  unset FAKE_DISK_USED_PERCENT FAKE_DISK_AVAILABLE_BYTES FAKE_INODE_USED_PERCENT
  unset FAKE_HEARTBEAT_FAIL
  rm -f -- "$TEST_ROOT/state/host-health-restarts.state" "$TEST_ROOT/state/host-health-memory.state"
  rm -f -- "$TEST_ROOT/restarts/"*
  : > "$FAKE_HEARTBEAT_LOG"
  write_markers
  write_memory 800000
}

expect_success() {
  local name="$1"
  if ! "$CHECKER" > "$TEST_ROOT/$name.out" 2> "$TEST_ROOT/$name.err"; then
    echo "Expected successful host check failed: $name" >&2
    cat "$TEST_ROOT/$name.err" >&2
    exit 1
  fi
}

expect_failure() {
  local name="$1"
  if "$CHECKER" > "$TEST_ROOT/$name.out" 2> "$TEST_ROOT/$name.err"; then
    echo "Expected failed host check succeeded: $name" >&2
    exit 1
  fi
}

reset_scenario
expect_success healthy
grep -Fxq 'success host-health' "$FAKE_HEARTBEAT_LOG"
[[ "$(grep -c '^success host-health$' "$FAKE_HEARTBEAT_LOG")" -eq 1 ]]
grep -Fq 'Host health check passed.' "$TEST_ROOT/healthy.out"

reset_scenario
export FAKE_DOCKER_UNAVAILABLE=true
expect_failure docker-unavailable
grep -Fq 'categories=docker' "$TEST_ROOT/docker-unavailable.err"
test ! -s "$FAKE_HEARTBEAT_LOG"

for problem in backend:missing backend:stopped backend:unhealthy; do
  reset_scenario
  export FAKE_CONTAINER_PROBLEM="$problem"
  expect_failure "container-${problem#*:}"
  grep -Fq 'categories=container' "$TEST_ROOT/container-${problem#*:}.err"
  test ! -s "$FAKE_HEARTBEAT_LOG"
done

reset_scenario
expect_success migrate-one-shot
reset_scenario
export FAKE_CONTAINER_PROBLEM=migrate:failed
expect_failure migrate-failed
grep -Fq 'one-shot did not complete successfully' "$TEST_ROOT/migrate-failed.err"

for problem in hoi4-postgres-backup.timer:disabled hoi4-offsite-backup.timer:inactive; do
  reset_scenario
  export FAKE_TIMER_PROBLEM="$problem"
  expect_failure "timer-${problem#*:}"
  grep -Fq 'categories=timer' "$TEST_ROOT/timer-${problem#*:}.err"
done

reset_scenario
export FAKE_TIMER_PROBLEM=hoi4-analysis-history-backup.timer:no-next
expect_failure timer-no-next
grep -Fq 'has no valid next run' "$TEST_ROOT/timer-no-next.err"

reset_scenario
rm -f -- "$TEST_ROOT/state/postgres.last-success"
expect_failure marker-missing
grep -Fq 'postgres success marker is missing' "$TEST_ROOT/marker-missing.err"

reset_scenario
stale_time="$(/usr/bin/date -u -d "@$((HOI4_MONITOR_NOW_EPOCH - 28 * 60 * 60))" '+%Y-%m-%dT%H:%M:%SZ')"
printf '%s\n' "$stale_time" > "$TEST_ROOT/state/offsite.last-success"
expect_failure marker-stale
grep -Fq 'offsite success marker is stale' "$TEST_ROOT/marker-stale.err"

reset_scenario
export FAKE_DISK_USED_PERCENT=85
expect_failure disk-warning
grep -Fq 'categories=disk-warning' "$TEST_ROOT/disk-warning.err"

reset_scenario
export FAKE_INODE_USED_PERCENT=85
expect_failure inode-warning
grep -Fq 'categories=inode-warning' "$TEST_ROOT/inode-warning.err"

reset_scenario
write_memory 140000
expect_success memory-first-low
expect_failure memory-second-low
grep -Fq 'categories=memory-warning' "$TEST_ROOT/memory-second-low.err"
[[ "$(grep -c '^success host-health$' "$FAKE_HEARTBEAT_LOG")" -eq 1 ]]

reset_scenario
expect_success restart-baseline
[[ "$(wc -l < "$TEST_ROOT/state/host-health-restarts.state")" -eq 4 ]]
for service_name in postgres backend frontend edge; do
  grep -q "^${service_name}"$'\t' "$TEST_ROOT/state/host-health-restarts.state"
done
printf '2\n' > "$TEST_ROOT/restarts/backend"
export HOI4_MONITOR_NOW_EPOCH=2000000300
expect_success restart-below-threshold
printf '3\n' > "$TEST_ROOT/restarts/backend"
export HOI4_MONITOR_NOW_EPOCH=2000000600
expect_failure restart-threshold
grep -Fq 'categories=container-restarts' "$TEST_ROOT/restart-threshold.err"
export HOI4_MONITOR_NOW_EPOCH=2000000000

reset_scenario
expect_success restart-state-before-docker-outage
cp -- "$TEST_ROOT/state/host-health-restarts.state" "$TEST_ROOT/restart-state-before-docker-outage"
export FAKE_DOCKER_UNAVAILABLE=true
expect_failure restart-state-docker-outage
grep -Fq 'categories=docker' "$TEST_ROOT/restart-state-docker-outage.err"
cmp -s -- \
  "$TEST_ROOT/restart-state-before-docker-outage" \
  "$TEST_ROOT/state/host-health-restarts.state"

reset_scenario
expect_success restart-state-before-compose-outage
cp -- "$TEST_ROOT/state/host-health-restarts.state" "$TEST_ROOT/restart-state-before-compose-outage"
export FAKE_COMPOSE_UNAVAILABLE=true
expect_failure restart-state-compose-outage
grep -Fq 'categories=container' "$TEST_ROOT/restart-state-compose-outage.err"
cmp -s -- \
  "$TEST_ROOT/restart-state-before-compose-outage" \
  "$TEST_ROOT/state/host-health-restarts.state"

reset_scenario
expect_success restart-state-before-recovery
cp -- "$TEST_ROOT/state/host-health-restarts.state" "$TEST_ROOT/restart-state-before-recovery"
printf '3\n' > "$TEST_ROOT/restarts/backend"
export HOI4_MONITOR_NOW_EPOCH=2000000300
export FAKE_COMPOSE_UNAVAILABLE=true
expect_failure restart-state-outage-before-recovery
cmp -s -- \
  "$TEST_ROOT/restart-state-before-recovery" \
  "$TEST_ROOT/state/host-health-restarts.state"
unset FAKE_COMPOSE_UNAVAILABLE
export HOI4_MONITOR_NOW_EPOCH=2000000600
expect_failure restart-state-recovery-detects-restarts
grep -Fq 'categories=container-restarts' "$TEST_ROOT/restart-state-recovery-detects-restarts.err"
export HOI4_MONITOR_NOW_EPOCH=2000000000

reset_scenario
export FAKE_DOCKER_UNAVAILABLE=true
export FAKE_TIMER_PROBLEM=hoi4-analysis-history-backup.timer:inactive
export FAKE_DISK_USED_PERCENT=85
rm -f -- "$TEST_ROOT/state/analysis-history.last-success"
expect_failure aggregated
grep -Fq 'backup-age' "$TEST_ROOT/aggregated.err"
grep -Fq 'disk-warning' "$TEST_ROOT/aggregated.err"
grep -Fq 'docker' "$TEST_ROOT/aggregated.err"
grep -Fq 'timer' "$TEST_ROOT/aggregated.err"
[[ "$(grep -c '^Host health check failed:' "$TEST_ROOT/aggregated.err")" -eq 1 ]]
test ! -s "$FAKE_HEARTBEAT_LOG"

reset_scenario
export FAKE_HEARTBEAT_FAIL=true
expect_success heartbeat-failure
grep -Fq 'checks passed, but the monitoring heartbeat failed' "$TEST_ROOT/heartbeat-failure.err"
if grep -Fq 'host-secret-token' "$TEST_ROOT/heartbeat-failure.out" "$TEST_ROOT/heartbeat-failure.err"; then
  echo "Host heartbeat secret leaked into checker output." >&2
  exit 1
fi

echo "host health checker tests: PASS"
