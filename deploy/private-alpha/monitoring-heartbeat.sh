#!/usr/bin/env bash

set -uo pipefail

umask 077

ACTION="${1:-}"
SUBJECT="${2:-}"
CURL_BIN="${HOI4_MONITOR_CURL_BIN:-/usr/bin/curl}"
STATE_DIR="${HOI4_MONITOR_STATE_DIR:-/var/lib/hoi4-save-tracker-monitor}"

usage() {
  echo "Usage: monitoring-heartbeat.sh <success|failure> <job-or-unit>" >&2
  exit 2
}

case "$SUBJECT" in
  postgres|hoi4-postgres-backup.service)
    job="postgres"
    heartbeat_url="${HOI4_MONITOR_POSTGRES_HEARTBEAT_URL:-}"
    ;;
  analysis-history|analysishistory|hoi4-analysis-history-backup.service)
    job="analysis-history"
    heartbeat_url="${HOI4_MONITOR_ANALYSIS_HISTORY_HEARTBEAT_URL:-}"
    ;;
  offsite|hoi4-offsite-backup.service)
    job="offsite"
    heartbeat_url="${HOI4_MONITOR_OFFSITE_HEARTBEAT_URL:-}"
    ;;
  host-health|hosthealth|hoi4-host-health.service)
    job="host-health"
    heartbeat_url="${HOI4_MONITOR_HOST_HEALTH_HEARTBEAT_URL:-}"
    ;;
  *)
    echo "Monitoring heartbeat subject is not allowlisted." >&2
    exit 2
    ;;
esac

if [[ "$ACTION" != "success" && "$ACTION" != "failure" ]]; then
  usage
fi

write_success_state() {
  local state_name="$job.last-success"
  local temporary_state=""

  if [[ "$STATE_DIR" != /* || "$STATE_DIR" == "/" || -L "$STATE_DIR" ]]; then
    return 1
  fi
  if ! install -d -m 0700 -- "$STATE_DIR"; then
    return 1
  fi
  if [[ ! -d "$STATE_DIR" || -L "$STATE_DIR" ]]; then
    return 1
  fi

  temporary_state="$(mktemp --tmpdir="$STATE_DIR" ".${state_name}.tmp.XXXXXX")" || return 1
  if ! printf '%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$temporary_state" ||
    ! chmod 0600 -- "$temporary_state" ||
    ! mv -- "$temporary_state" "$STATE_DIR/$state_name"; then
    rm -f -- "$temporary_state"
    return 1
  fi
}

state_failed=false
if [[ "$ACTION" == "success" ]]; then
  if ! write_success_state; then
    echo "Monitoring success state could not be recorded for $job." >&2
    state_failed=true
  fi
fi

if [[ -z "$heartbeat_url" ]]; then
  echo "Monitoring heartbeat is not configured for $job; delivery skipped." >&2
  if [[ "$state_failed" == true ]]; then
    exit 1
  fi
  exit 0
fi

if [[ ! "$heartbeat_url" =~ ^https://uptime\.betterstack\.com/api/v1/heartbeat/[A-Za-z0-9_-]+$ ]]; then
  echo "Monitoring heartbeat configuration is invalid for $job." >&2
  exit 1
fi

if [[ "$CURL_BIN" != /* || ! -x "$CURL_BIN" ]]; then
  echo "Monitoring heartbeat transport is unavailable for $job." >&2
  exit 1
fi

delivery_url="$heartbeat_url"
if [[ "$ACTION" == "failure" ]]; then
  delivery_url+="/fail"
fi

if ! "$CURL_BIN" \
  --silent \
  --show-error \
  --fail \
  --output /dev/null \
  --proto '=https' \
  --connect-timeout 2 \
  --max-time 5 \
  "$delivery_url" 2> /dev/null; then
  echo "Monitoring heartbeat delivery failed for $job ($ACTION)." >&2
  exit 1
fi

echo "Monitoring heartbeat delivered for $job ($ACTION)."
if [[ "$state_failed" == true ]]; then
  exit 1
fi
exit 0
