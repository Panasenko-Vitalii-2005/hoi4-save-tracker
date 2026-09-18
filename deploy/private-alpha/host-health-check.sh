#!/usr/bin/env bash

set -euo pipefail

umask 077

PROJECT_DIR="${HOI4_MONITOR_PROJECT_DIR:-/opt/hoi4-save-tracker}"
ENV_FILE="${HOI4_MONITOR_PRIVATE_ALPHA_ENV_FILE:-$PROJECT_DIR/.env.private-alpha}"
POSTGRES_BACKUP_DIR="${HOI4_MONITOR_POSTGRES_BACKUP_DIR:-/var/backups/hoi4-save-tracker/postgres}"
HISTORY_BACKUP_DIR="${HOI4_MONITOR_ANALYSIS_HISTORY_BACKUP_DIR:-/var/backups/hoi4-save-tracker/analysis-history}"
STATE_DIR="${HOI4_MONITOR_STATE_DIR:-/var/lib/hoi4-save-tracker-monitor}"
MEMINFO_PATH="${HOI4_MONITOR_MEMINFO_PATH:-/proc/meminfo}"
DOCKER_BIN="${HOI4_MONITOR_DOCKER_BIN:-/usr/bin/docker}"
SYSTEMCTL_BIN="${HOI4_MONITOR_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
DF_BIN="${HOI4_MONITOR_DF_BIN:-/usr/bin/df}"
DATE_BIN="${HOI4_MONITOR_DATE_BIN:-/usr/bin/date}"
FLOCK_BIN="${HOI4_MONITOR_FLOCK_BIN:-/usr/bin/flock}"
HEARTBEAT_BIN="${HOI4_MONITOR_HEARTBEAT_BIN:-/usr/local/sbin/hoi4-save-tracker-heartbeat}"
NOW_EPOCH="${HOI4_MONITOR_NOW_EPOCH:-$($DATE_BIN -u '+%s')}"

readonly DISK_WARNING_PERCENT=80
readonly DISK_CRITICAL_PERCENT=90
readonly DISK_WARNING_AVAILABLE_BYTES=$((5 * 1024 * 1024 * 1024))
readonly DISK_CRITICAL_AVAILABLE_BYTES=$((2 * 1024 * 1024 * 1024))
readonly INODE_WARNING_PERCENT=80
readonly INODE_CRITICAL_PERCENT=90
readonly MEMORY_WARNING_PERCENT=15
readonly MEMORY_CRITICAL_PERCENT=8
readonly MEMORY_WARNING_SAMPLES=2
readonly RESTART_WINDOW_SECONDS=$((15 * 60))
readonly RESTART_CRITICAL_DELTA=3
readonly TIMER_PAST_TOLERANCE_SECONDS=$((5 * 60))
readonly TIMER_FUTURE_LIMIT_SECONDS=$((30 * 60 * 60))

declare -a failures=()
declare -A failure_categories=()

add_failure() {
  local category="$1"
  local message="$2"

  failures+=("$category|$message")
  failure_categories["$category"]=1
}

for executable in "$DOCKER_BIN" "$SYSTEMCTL_BIN" "$DF_BIN" "$DATE_BIN" "$FLOCK_BIN"; do
  if [[ "$executable" != /* || ! -x "$executable" ]]; then
    echo "Host health checker dependency is unavailable." >&2
    exit 1
  fi
done

if [[ ! "$NOW_EPOCH" =~ ^[0-9]+$ ]]; then
  echo "Host health checker received an invalid current time." >&2
  exit 1
fi

for configured_path in "$PROJECT_DIR" "$ENV_FILE" "$POSTGRES_BACKUP_DIR" "$HISTORY_BACKUP_DIR" "$STATE_DIR" "$MEMINFO_PATH"; do
  if [[ "$configured_path" != /* ]]; then
    echo "Host health checker paths must be absolute." >&2
    exit 1
  fi
done

if [[ "$STATE_DIR" == "/" || -L "$STATE_DIR" ]]; then
  echo "Host health state directory is unsafe." >&2
  exit 1
fi
install -d -m 0700 -- "$STATE_DIR"
chmod 0700 -- "$STATE_DIR"
STATE_DIR="$(cd -- "$STATE_DIR" && pwd -P)"

exec 9>"$STATE_DIR/.host-health.lock"
if ! "$FLOCK_BIN" -n 9; then
  echo "Another host health check is already running." >&2
  exit 1
fi

restart_state="$STATE_DIR/host-health-restarts.state"
memory_state="$STATE_DIR/host-health-memory.state"

declare -A previous_container_id=()
declare -A previous_restart_count=()
declare -A previous_window_start=()
declare -A previous_window_delta=()
declare -A current_container_id=()
declare -A current_restart_count=()
declare -A current_window_start=()
declare -A current_window_delta=()

if [[ -e "$restart_state" ]]; then
  if [[ ! -f "$restart_state" || -L "$restart_state" ]]; then
    add_failure state "restart state is not a regular file"
  else
    while IFS=$'\t' read -r service_name container_id restart_count window_start window_delta; do
      case "$service_name" in
        postgres|backend|frontend|edge) ;;
        *)
          add_failure state "restart state contains an unknown service"
          continue
          ;;
      esac
      if [[ ! "$container_id" =~ ^[A-Za-z0-9_.-]+$ ||
        ! "$restart_count" =~ ^[0-9]+$ ||
        ! "$window_start" =~ ^[0-9]+$ ||
        ! "$window_delta" =~ ^[0-9]+$ ]]; then
        add_failure state "restart state contains malformed data"
        continue
      fi
      previous_container_id["$service_name"]="$container_id"
      previous_restart_count["$service_name"]="$restart_count"
      previous_window_start["$service_name"]="$window_start"
      previous_window_delta["$service_name"]="$window_delta"
    done < "$restart_state"
  fi
fi

record_restart_sample() {
  local service_name="$1"
  local container_id="$2"
  local restart_count="$3"
  local window_start="$NOW_EPOCH"
  local window_delta=0
  local increment=0

  if [[ "${previous_container_id[$service_name]:-}" == "$container_id" &&
    "$restart_count" -ge "${previous_restart_count[$service_name]:-0}" ]]; then
    increment=$((restart_count - previous_restart_count[$service_name]))
    if (( NOW_EPOCH - ${previous_window_start[$service_name]:-0} <= RESTART_WINDOW_SECONDS )); then
      window_start="${previous_window_start[$service_name]}"
      window_delta=$(( ${previous_window_delta[$service_name]:-0} + increment ))
    else
      window_delta="$increment"
    fi
  fi

  if (( window_delta >= RESTART_CRITICAL_DELTA )); then
    add_failure container-restarts "$service_name restarted at least $RESTART_CRITICAL_DELTA times within 15 minutes"
    window_start="$NOW_EPOCH"
    window_delta=0
  fi

  current_container_id["$service_name"]="$container_id"
  current_restart_count["$service_name"]="$restart_count"
  current_window_start["$service_name"]="$window_start"
  current_window_delta["$service_name"]="$window_delta"
}

docker_available=false
docker_root=""
docker_info=""
if docker_info="$($DOCKER_BIN info --format '{{.ServerVersion}}|{{.DockerRootDir}}' 2> /dev/null)"; then
  IFS='|' read -r docker_version docker_root <<< "$docker_info"
  if [[ -n "$docker_version" && "$docker_root" == /* && -d "$docker_root" ]]; then
    docker_available=true
  else
    add_failure docker "daemon information was incomplete"
  fi
else
  add_failure docker "daemon is unavailable"
fi

compose_available=true
if [[ ! -d "$PROJECT_DIR" || ! -f "$PROJECT_DIR/docker-compose.yml" ||
  ! -f "$PROJECT_DIR/docker-compose.private-alpha.yml" || ! -f "$ENV_FILE" ]]; then
  add_failure compose "private-alpha Compose configuration is unavailable"
  compose_available=false
fi

compose=(
  "$DOCKER_BIN" compose
  --project-directory "$PROJECT_DIR"
  --env-file "$ENV_FILE"
  -f "$PROJECT_DIR/docker-compose.yml"
  -f "$PROJECT_DIR/docker-compose.private-alpha.yml"
)

inspect_service() {
  local service_name="$1"
  local expected_health="$2"
  local one_shot="$3"
  local ids_output=""
  local inspect_output=""
  local container_id=""
  local status=""
  local health=""
  local restart_count=""
  local exit_code=""
  local -a container_ids=()

  if ! ids_output="$("${compose[@]}" ps --all --quiet "$service_name" 2> /dev/null)"; then
    add_failure container "could not inspect $service_name"
    return
  fi
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] && container_ids+=("$container_id")
  done <<< "$ids_output"
  if (( ${#container_ids[@]} != 1 )); then
    add_failure container "$service_name is missing or has an unexpected instance count"
    return
  fi
  container_id="${container_ids[0]}"

  if ! inspect_output="$($DOCKER_BIN inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.State.ExitCode}}' "$container_id" 2> /dev/null)"; then
    add_failure container "could not inspect $service_name state"
    return
  fi
  IFS='|' read -r status health restart_count exit_code <<< "$inspect_output"
  if [[ ! "$restart_count" =~ ^[0-9]+$ || ! "$exit_code" =~ ^-?[0-9]+$ ]]; then
    add_failure container "$service_name returned malformed state"
    return
  fi

  if [[ "$one_shot" == true ]]; then
    if [[ "$status" == "running" ]]; then
      return
    fi
    if [[ "$status" != "exited" || "$exit_code" -ne 0 ]]; then
      add_failure container "$service_name one-shot did not complete successfully"
    fi
    return
  fi

  if [[ "$status" != "running" ]]; then
    add_failure container "$service_name is not running"
  elif [[ "$expected_health" == "healthy" && "$health" != "healthy" ]]; then
    add_failure container "$service_name is not healthy"
  elif [[ "$expected_health" == "none" && "$health" != "none" && "$health" != "healthy" ]]; then
    add_failure container "$service_name has an unhealthy runtime state"
  fi

  record_restart_sample "$service_name" "$container_id" "$restart_count"
}

if [[ "$docker_available" == true && "$compose_available" == true ]]; then
  inspect_service postgres healthy false
  inspect_service backend healthy false
  inspect_service frontend healthy false
  inspect_service edge none false
  inspect_service migrate none true
fi

restart_sampling_complete=true
for service_name in postgres backend frontend edge; do
  if [[ -z "${current_container_id[$service_name]:-}" ]]; then
    restart_sampling_complete=false
    break
  fi
done

write_restart_state() {
  local temporary_state=""
  local service_name=""

  temporary_state="$(mktemp --tmpdir="$STATE_DIR" '.host-health-restarts.tmp.XXXXXX')" || return 1
  if ! {
    for service_name in postgres backend frontend edge; do
      if [[ -n "${current_container_id[$service_name]:-}" ]]; then
        printf '%s\t%s\t%s\t%s\t%s\n' \
          "$service_name" \
          "${current_container_id[$service_name]}" \
          "${current_restart_count[$service_name]}" \
          "${current_window_start[$service_name]}" \
          "${current_window_delta[$service_name]}"
      fi
    done
  } > "$temporary_state" ||
    ! chmod 0600 -- "$temporary_state" ||
    ! mv -- "$temporary_state" "$restart_state"; then
    rm -f -- "$temporary_state"
    return 1
  fi
}

if [[ "$restart_sampling_complete" == true ]] && ! write_restart_state; then
  add_failure state "restart state could not be persisted"
fi

for timer_name in \
  hoi4-postgres-backup.timer \
  hoi4-analysis-history-backup.timer \
  hoi4-offsite-backup.timer; do
  if ! "$SYSTEMCTL_BIN" is-enabled --quiet "$timer_name"; then
    add_failure timer "$timer_name is not enabled"
  fi
  if ! "$SYSTEMCTL_BIN" is-active --quiet "$timer_name"; then
    add_failure timer "$timer_name is not active"
  fi

  next_run="$($SYSTEMCTL_BIN show --property=NextElapseUSecRealtime --value "$timer_name" 2> /dev/null || true)"
  next_epoch=""
  if [[ -z "$next_run" || "$next_run" == "n/a" ]] ||
    ! next_epoch="$($DATE_BIN -u -d "$next_run" '+%s' 2> /dev/null)" ||
    [[ ! "$next_epoch" =~ ^[0-9]+$ ]]; then
    add_failure timer "$timer_name has no valid next run"
  elif (( next_epoch < NOW_EPOCH - TIMER_PAST_TOLERANCE_SECONDS ||
    next_epoch > NOW_EPOCH + TIMER_FUTURE_LIMIT_SECONDS )); then
    add_failure timer "$timer_name has an implausible next run"
  fi
done

check_success_marker() {
  local marker_name="$1"
  local maximum_age="$2"
  local marker_path="$STATE_DIR/$marker_name.last-success"
  local timestamp=""
  local marker_epoch=""
  local age=0

  if [[ ! -f "$marker_path" || -L "$marker_path" ]]; then
    add_failure backup-age "$marker_name success marker is missing"
    return
  fi
  timestamp="$(<"$marker_path")"
  if [[ ! "$timestamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    ! marker_epoch="$($DATE_BIN -u -d "$timestamp" '+%s' 2> /dev/null)" ||
    [[ ! "$marker_epoch" =~ ^[0-9]+$ ]]; then
    add_failure backup-age "$marker_name success marker is invalid"
    return
  fi
  age=$((NOW_EPOCH - marker_epoch))
  if (( age < -TIMER_PAST_TOLERANCE_SECONDS )); then
    add_failure backup-age "$marker_name success marker is in the future"
  elif (( age > maximum_age )); then
    add_failure backup-age "$marker_name success marker is stale"
  fi
}

check_success_marker postgres $((25 * 60 * 60 + 30 * 60))
check_success_marker analysis-history $((26 * 60 * 60))
check_success_marker offsite $((27 * 60 * 60))

declare -A checked_filesystems=()
check_filesystem() {
  local label="$1"
  local path="$2"
  local byte_output=""
  local inode_output=""
  local byte_line=""
  local inode_line=""
  local filesystem=""
  local blocks=""
  local used=""
  local available=""
  local use_percent=""
  local mountpoint=""
  local inode_filesystem=""
  local inodes=""
  local inodes_used=""
  local inodes_free=""
  local inode_percent=""
  local inode_mountpoint=""

  if [[ ! -e "$path" ]]; then
    add_failure filesystem "$label path is unavailable"
    return
  fi
  if ! byte_output="$($DF_BIN -P -B1 -- "$path" 2> /dev/null)"; then
    add_failure filesystem "$label filesystem could not be inspected"
    return
  fi
  byte_line="${byte_output##*$'\n'}"
  read -r filesystem blocks used available use_percent mountpoint <<< "$byte_line"
  use_percent="${use_percent%%%}"
  if [[ -z "$filesystem" || ! "$available" =~ ^[0-9]+$ || ! "$use_percent" =~ ^[0-9]+$ ]]; then
    add_failure filesystem "$label filesystem returned malformed capacity data"
    return
  fi
  if [[ -n "${checked_filesystems[$filesystem]:-}" ]]; then
    return
  fi
  checked_filesystems["$filesystem"]=1

  if (( use_percent >= DISK_CRITICAL_PERCENT || available < DISK_CRITICAL_AVAILABLE_BYTES )); then
    add_failure disk-critical "$label filesystem has critical free space"
  elif (( use_percent >= DISK_WARNING_PERCENT || available < DISK_WARNING_AVAILABLE_BYTES )); then
    add_failure disk-warning "$label filesystem has low free space"
  fi

  if ! inode_output="$($DF_BIN -Pi -- "$path" 2> /dev/null)"; then
    add_failure filesystem "$label inode capacity could not be inspected"
    return
  fi
  inode_line="${inode_output##*$'\n'}"
  read -r inode_filesystem inodes inodes_used inodes_free inode_percent inode_mountpoint <<< "$inode_line"
  inode_percent="${inode_percent%%%}"
  if [[ "$inode_filesystem" != "$filesystem" || ! "$inode_percent" =~ ^[0-9]+$ ]]; then
    add_failure filesystem "$label filesystem returned malformed inode data"
    return
  fi
  if (( inode_percent >= INODE_CRITICAL_PERCENT )); then
    add_failure inode-critical "$label filesystem has critical inode usage"
  elif (( inode_percent >= INODE_WARNING_PERCENT )); then
    add_failure inode-warning "$label filesystem has high inode usage"
  fi
}

check_filesystem root /
[[ -n "$docker_root" ]] && check_filesystem docker "$docker_root"
check_filesystem project "$PROJECT_DIR"
check_filesystem postgres-backups "$POSTGRES_BACKUP_DIR"
check_filesystem analysis-history-backups "$HISTORY_BACKUP_DIR"
check_filesystem monitor-state "$STATE_DIR"

memory_low_count=0
if [[ -e "$memory_state" ]]; then
  if [[ ! -f "$memory_state" || -L "$memory_state" ]]; then
    add_failure state "memory state is not a regular file"
  else
    IFS= read -r memory_low_count < "$memory_state" || true
    if [[ ! "$memory_low_count" =~ ^[0-9]+$ ]]; then
      add_failure state "memory state contains malformed data"
      memory_low_count=0
    fi
  fi
fi

memory_total=""
memory_available=""
if [[ ! -f "$MEMINFO_PATH" || -L "$MEMINFO_PATH" ]]; then
  add_failure memory "MemAvailable source is unavailable"
else
  memory_total="$(awk '$1 == "MemTotal:" { print $2; exit }' "$MEMINFO_PATH")"
  memory_available="$(awk '$1 == "MemAvailable:" { print $2; exit }' "$MEMINFO_PATH")"
  if [[ ! "$memory_total" =~ ^[1-9][0-9]*$ || ! "$memory_available" =~ ^[0-9]+$ ]]; then
    add_failure memory "MemAvailable data is malformed"
    memory_low_count=0
  else
    memory_percent=$((memory_available * 100 / memory_total))
    if (( memory_percent < MEMORY_CRITICAL_PERCENT )); then
      add_failure memory-critical "available memory is below 8 percent"
      memory_low_count=$((memory_low_count + 1))
    elif (( memory_percent < MEMORY_WARNING_PERCENT )); then
      memory_low_count=$((memory_low_count + 1))
      if (( memory_low_count >= MEMORY_WARNING_SAMPLES )); then
        add_failure memory-warning "available memory stayed below 15 percent for two checks"
      fi
    else
      memory_low_count=0
    fi
  fi
fi

write_memory_state() {
  local temporary_state=""

  temporary_state="$(mktemp --tmpdir="$STATE_DIR" '.host-health-memory.tmp.XXXXXX')" || return 1
  if ! printf '%s\n' "$memory_low_count" > "$temporary_state" ||
    ! chmod 0600 -- "$temporary_state" ||
    ! mv -- "$temporary_state" "$memory_state"; then
    rm -f -- "$temporary_state"
    return 1
  fi
}

if ! write_memory_state; then
  add_failure state "memory state could not be persisted"
fi

if (( ${#failures[@]} > 0 )); then
  for failure in "${failures[@]}"; do
    printf 'Host health failure [%s]: %s.\n' "${failure%%|*}" "${failure#*|}" >&2
  done
  categories="$(printf '%s\n' "${!failure_categories[@]}" | sort | paste -sd, -)"
  printf 'Host health check failed: categories=%s.\n' "$categories" >&2
  exit 1
fi

if [[ "$HEARTBEAT_BIN" == /* && -x "$HEARTBEAT_BIN" ]]; then
  if ! "$HEARTBEAT_BIN" success host-health; then
    echo "Host health checks passed, but the monitoring heartbeat failed." >&2
  fi
else
  echo "Host health checks passed, but the monitoring heartbeat helper is unavailable." >&2
fi

echo "Host health check passed."
