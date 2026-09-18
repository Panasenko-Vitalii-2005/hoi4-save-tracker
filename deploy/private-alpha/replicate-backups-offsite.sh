#!/usr/bin/env bash

set -euo pipefail

umask 077

POSTGRES_DIR="${HOI4_OFFSITE_POSTGRES_BACKUP_DIR:-/var/backups/hoi4-save-tracker/postgres}"
HISTORY_DIR="${HOI4_OFFSITE_ANALYSIS_HISTORY_BACKUP_DIR:-/var/backups/hoi4-save-tracker/analysis-history}"
WORK_DIR="${HOI4_OFFSITE_WORK_DIR:-/var/tmp/hoi4-save-tracker-offsite}"
RCLONE_BIN="${HOI4_OFFSITE_RCLONE_BIN:-/usr/local/bin/rclone}"
RCLONE_CONFIG="${HOI4_OFFSITE_RCLONE_CONFIG:-}"
RCLONE_REMOTE="${HOI4_OFFSITE_RCLONE_REMOTE:-}"
RCLONE_BUCKET="${HOI4_OFFSITE_BUCKET:-}"
RCLONE_PREFIX="${HOI4_OFFSITE_PREFIX:-}"
HEARTBEAT_BIN="${HOI4_MONITOR_HEARTBEAT_BIN:-/usr/local/sbin/hoi4-save-tracker-heartbeat}"

fail() {
  echo "$1" >&2
  exit 1
}

for source_directory in "$POSTGRES_DIR" "$HISTORY_DIR"; do
  if [[ "$source_directory" != /* || ! -d "$source_directory" ]]; then
    fail "Required local backup directory is missing or is not absolute: $source_directory"
  fi
done

if [[ "$WORK_DIR" != /* || "$WORK_DIR" == "/" ]]; then
  fail "HOI4_OFFSITE_WORK_DIR must be an absolute directory other than /."
fi

if [[ "$RCLONE_BIN" != /* || ! -x "$RCLONE_BIN" ]]; then
  fail "HOI4_OFFSITE_RCLONE_BIN must name an executable absolute path."
fi

if [[ -z "$RCLONE_CONFIG" || "$RCLONE_CONFIG" != /* || ! -f "$RCLONE_CONFIG" || ! -r "$RCLONE_CONFIG" ]]; then
  fail "HOI4_OFFSITE_RCLONE_CONFIG must name a readable absolute file."
fi

if [[ ! "$RCLONE_REMOTE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  fail "HOI4_OFFSITE_RCLONE_REMOTE contains unsupported characters."
fi

if [[ ! "$RCLONE_BUCKET" =~ ^[a-z0-9][a-z0-9.-]*[a-z0-9]$ ]]; then
  fail "HOI4_OFFSITE_BUCKET is not a valid bucket name."
fi

if [[ ! "$RCLONE_PREFIX" =~ ^[A-Za-z0-9._/-]+$ || "$RCLONE_PREFIX" == /* || "$RCLONE_PREFIX" == */ || "$RCLONE_PREFIX" == *//* ]]; then
  fail "HOI4_OFFSITE_PREFIX is not a safe relative object prefix."
fi

IFS='/' read -r -a prefix_segments <<< "$RCLONE_PREFIX"
for prefix_segment in "${prefix_segments[@]}"; do
  if [[ "$prefix_segment" == "." || "$prefix_segment" == ".." ]]; then
    fail "HOI4_OFFSITE_PREFIX must not contain dot path segments."
  fi
done

version_output="$("$RCLONE_BIN" version)"
version_line="${version_output%%$'\n'*}"
if [[ ! "$version_line" =~ ^rclone[[:space:]]+v([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
  fail "Could not determine the installed rclone version."
fi

rclone_major="${BASH_REMATCH[1]}"
rclone_minor="${BASH_REMATCH[2]}"
if (( rclone_major < 1 || (rclone_major == 1 && rclone_minor < 75) )); then
  fail "rclone 1.75.0 or newer is required."
fi

POSTGRES_DIR="$(cd -- "$POSTGRES_DIR" && pwd -P)"
HISTORY_DIR="$(cd -- "$HISTORY_DIR" && pwd -P)"
install -d -m 0700 -- "$WORK_DIR"
chmod 0700 -- "$WORK_DIR"
WORK_DIR="$(cd -- "$WORK_DIR" && pwd -P)"

exec 9>"$WORK_DIR/.replication.lock"
if ! flock -n 9; then
  fail "Another off-site backup replication is already running."
fi

verification_dir="$(mktemp -d --tmpdir="$WORK_DIR" ".verify.XXXXXX")"

send_success_heartbeat() {
  if [[ "$HEARTBEAT_BIN" == /* && -x "$HEARTBEAT_BIN" ]]; then
    if ! "$HEARTBEAT_BIN" success offsite; then
      echo "Off-site replication succeeded, but its monitoring heartbeat failed." >&2
    fi
  else
    echo "Off-site replication succeeded, but its monitoring heartbeat helper is unavailable." >&2
  fi
  return 0
}

cleanup() {
  status=$?
  trap - EXIT INT TERM HUP

  case "$verification_dir" in
    "$WORK_DIR"/.verify.*)
      if [[ -d "$verification_dir" && ! -L "$verification_dir" ]]; then
        rm -rf -- "$verification_dir"
      fi
      ;;
    *)
      echo "Refusing to remove an unexpected verification directory." >&2
      status=1
      ;;
  esac

  if (( status == 0 )); then
    send_success_heartbeat
  fi

  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

remote_root="${RCLONE_REMOTE}:${RCLONE_BUCKET}/${RCLONE_PREFIX}"
declared_hash=""

validate_local_pair() {
  local source_directory="$1"
  local data_name="$2"
  local data_path="$source_directory/$data_name"
  local checksum_path="$data_path.sha256"
  local checksum_record
  local checksum_size
  local expected_checksum_size
  local actual_hash

  checksum_size="$(wc -c < "$checksum_path")"
  checksum_size="${checksum_size//[[:space:]]/}"
  expected_checksum_size=$((64 + 2 + ${#data_name} + 1))
  if [[ ! "$checksum_size" =~ ^[0-9]+$ || "$checksum_size" -ne "$expected_checksum_size" ]]; then
    fail "Invalid checksum metadata for $data_name."
  fi

  checksum_record="$(<"$checksum_path")"
  if [[ "$checksum_record" == *$'\n'* || ${#checksum_record} -ne $((expected_checksum_size - 1)) ]]; then
    fail "Invalid checksum metadata for $data_name."
  fi

  declared_hash="${checksum_record:0:64}"
  if [[ ! "$declared_hash" =~ ^[[:xdigit:]]{64}$ || "${checksum_record:64:2}" != "  " || "${checksum_record:66}" != "$data_name" ]]; then
    fail "Checksum metadata does not name the expected local file: $data_name."
  fi

  actual_hash="$(sha256sum -- "$data_path" | cut -d ' ' -f 1)"
  if [[ "${actual_hash,,}" != "${declared_hash,,}" ]]; then
    fail "Local checksum verification failed for $data_name."
  fi
}

download_remote_object() {
  local remote_object="$1"
  local temporary_path="$2"

  rm -f -- "$temporary_path"
  "$RCLONE_BIN" copyto "$remote_object" "$temporary_path" \
    --config "$RCLONE_CONFIG" --quiet
}

remote_data_matches() {
  local remote_object="$1"
  local temporary_path="$verification_dir/remote-data"
  local remote_hash

  if ! download_remote_object "$remote_object" "$temporary_path"; then
    rm -f -- "$temporary_path"
    return 1
  fi

  if [[ ! -f "$temporary_path" || -L "$temporary_path" ]]; then
    rm -f -- "$temporary_path"
    return 1
  fi

  remote_hash="$(sha256sum -- "$temporary_path" | cut -d ' ' -f 1)"
  rm -f -- "$temporary_path"
  [[ "${remote_hash,,}" == "${declared_hash,,}" ]]
}

remote_checksum_matches() {
  local local_checksum="$1"
  local remote_object="$2"
  local temporary_path="$verification_dir/remote-checksum"

  if ! download_remote_object "$remote_object" "$temporary_path"; then
    rm -f -- "$temporary_path"
    return 1
  fi

  if [[ ! -f "$temporary_path" || -L "$temporary_path" ]]; then
    rm -f -- "$temporary_path"
    return 1
  fi

  if cmp -s -- "$local_checksum" "$temporary_path"; then
    rm -f -- "$temporary_path"
    return 0
  fi

  rm -f -- "$temporary_path"
  return 1
}

upload_object() {
  local local_path="$1"
  local remote_object="$2"

  "$RCLONE_BIN" copyto "$local_path" "$remote_object" \
    --config "$RCLONE_CONFIG" --ignore-times --quiet
}

replicate_generation() {
  local source_directory="$1"
  local data_name="$2"
  local remote_section="$3"
  local data_path="$source_directory/$data_name"
  local checksum_path="$data_path.sha256"
  local remote_data="$remote_root/$remote_section/$data_name"
  local remote_checksum="$remote_data.sha256"

  validate_local_pair "$source_directory" "$data_name"

  if ! remote_data_matches "$remote_data"; then
    echo "Uploading data object: $remote_section/$data_name"
    upload_object "$data_path" "$remote_data"
    if ! remote_data_matches "$remote_data"; then
      fail "Remote data verification failed for $remote_section/$data_name."
    fi
  fi

  if ! remote_checksum_matches "$checksum_path" "$remote_checksum"; then
    echo "Uploading checksum object: $remote_section/$data_name.sha256"
    upload_object "$checksum_path" "$remote_checksum"
    if ! remote_checksum_matches "$checksum_path" "$remote_checksum"; then
      fail "Remote checksum verification failed for $remote_section/$data_name.sha256."
    fi
  fi

  echo "Off-site generation verified: $remote_section/$data_name"
}

replicate_directory() {
  local source_directory="$1"
  local remote_section="$2"
  local data_pattern="$3"
  local checksum_pattern="$4"
  local data_name
  local checksum_name
  local eligible_count=0
  local -a eligible_names=()

  while IFS= read -r -d '' data_name; do
    data_name="${data_name#./}"
    if [[ "$data_name" =~ $data_pattern ]]; then
      if [[ -f "$source_directory/$data_name.sha256" && ! -L "$source_directory/$data_name.sha256" ]]; then
        eligible_names+=("$data_name")
      else
        echo "Skipping incomplete local generation without checksum: $remote_section/$data_name" >&2
      fi
    fi
  done < <(cd -- "$source_directory" && find . -maxdepth 1 -type f -print0 | sort -z)

  while IFS= read -r -d '' checksum_name; do
    checksum_name="${checksum_name#./}"
    if [[ "$checksum_name" =~ $checksum_pattern ]]; then
      data_name="${checksum_name%.sha256}"
      if [[ ! -f "$source_directory/$data_name" || -L "$source_directory/$data_name" ]]; then
        echo "Skipping orphan local checksum without data: $remote_section/$checksum_name" >&2
      fi
    fi
  done < <(cd -- "$source_directory" && find . -maxdepth 1 -type f -print0 | sort -z)

  for data_name in "${eligible_names[@]}"; do
    replicate_generation "$source_directory" "$data_name" "$remote_section"
    ((eligible_count += 1))
  done

  if (( eligible_count == 0 )); then
    fail "No complete local backup generations were found in $source_directory."
  fi
}

replicate_directory \
  "$POSTGRES_DIR" \
  "postgres" \
  '^hoi4_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$' \
  '^hoi4_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump\.sha256$'

replicate_directory \
  "$HISTORY_DIR" \
  "analysis-history" \
  '^analysis-history_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.tar\.gz$' \
  '^analysis-history_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.tar\.gz\.sha256$'

echo "All retained local backup generations are verified off-site."
