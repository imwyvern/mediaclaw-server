#!/usr/bin/env bash
set -Eeuo pipefail

# Cron example:
# 0 3 * * * /path/to/project/aitoearn-backend/scripts/backup.sh >> /var/log/mediaclaw/backup.log 2>&1

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/mediaclaw}"
BACKUP_BUCKET_URL="${BACKUP_BUCKET_URL:-}"
BACKUP_MONGODB_URI="${BACKUP_MONGODB_URI:-}"
BACKUP_RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"
BACKUP_RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-4}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WEEKDAY="$(date -u +%u)"
IS_WEEKLY=0

log() {
  printf '[backup] %s\n' "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'missing required command: %s\n' "$1" >&2
    exit 1
  }
}

prune_local() {
  local target_dir="$1"
  local keep_count="$2"
  if [[ ! -d "${target_dir}" ]]; then
    return
  fi

  mapfile -t archives < <(find "${target_dir}" -maxdepth 1 -type f -name '*.archive.gz' | sort -r)
  if (( ${#archives[@]} <= keep_count )); then
    return
  fi

  for archive in "${archives[@]:keep_count}"; do
    rm -f "${archive}"
  done
}

upload_archive() {
  local archive_path="$1"
  local tier="$2"
  local object_name
  object_name="$(basename "${archive_path}")"

  if [[ -z "${BACKUP_BUCKET_URL}" ]]; then
    log "BACKUP_BUCKET_URL is empty, skip remote upload"
    return
  fi

  case "${BACKUP_BUCKET_URL}" in
    s3://*)
      require_cmd aws
      aws s3 cp "${archive_path}" "${BACKUP_BUCKET_URL%/}/${tier}/${object_name}"
      ;;
    oss://*)
      require_cmd ossutil
      ossutil cp "${archive_path}" "${BACKUP_BUCKET_URL%/}/${tier}/${object_name}"
      ;;
    *)
      printf 'unsupported BACKUP_BUCKET_URL scheme: %s\n' "${BACKUP_BUCKET_URL}" >&2
      exit 1
      ;;
  esac
}

prune_remote_s3() {
  local tier="$1"
  local keep_count="$2"
  local prefix="${BACKUP_BUCKET_URL%/}/${tier}/"
  mapfile -t objects < <(aws s3 ls "${prefix}" | awk '{ print $4 }' | sort -r)
  if (( ${#objects[@]} <= keep_count )); then
    return
  fi

  for object_name in "${objects[@]:keep_count}"; do
    aws s3 rm "${prefix}${object_name}"
  done
}

prune_remote_oss() {
  local tier="$1"
  local keep_count="$2"
  local prefix="${BACKUP_BUCKET_URL%/}/${tier}/"
  mapfile -t objects < <(ossutil ls "${prefix}" | awk '/\.archive\.gz$/ { print $NF }' | sort -r)
  if (( ${#objects[@]} <= keep_count )); then
    return
  fi

  for object_path in "${objects[@]:keep_count}"; do
    ossutil rm "${object_path}"
  done
}

prune_remote() {
  local tier="$1"
  local keep_count="$2"

  if [[ -z "${BACKUP_BUCKET_URL}" ]]; then
    return
  fi

  case "${BACKUP_BUCKET_URL}" in
    s3://*)
      prune_remote_s3 "${tier}" "${keep_count}"
      ;;
    oss://*)
      prune_remote_oss "${tier}" "${keep_count}"
      ;;
  esac
}

require_cmd mongodump

if [[ -z "${BACKUP_MONGODB_URI}" ]]; then
  printf 'BACKUP_MONGODB_URI is required\n' >&2
  exit 1
fi

mkdir -p "${BACKUP_ROOT}/daily" "${BACKUP_ROOT}/weekly"

DAILY_ARCHIVE="${BACKUP_ROOT}/daily/mediaclaw-${TIMESTAMP}.archive.gz"
log "creating mongodb archive ${DAILY_ARCHIVE}"
mongodump --uri="${BACKUP_MONGODB_URI}" --archive="${DAILY_ARCHIVE}" --gzip
upload_archive "${DAILY_ARCHIVE}" "daily"

if [[ "${WEEKDAY}" == "7" ]]; then
  IS_WEEKLY=1
  WEEKLY_ARCHIVE="${BACKUP_ROOT}/weekly/mediaclaw-weekly-${TIMESTAMP}.archive.gz"
  cp "${DAILY_ARCHIVE}" "${WEEKLY_ARCHIVE}"
  upload_archive "${WEEKLY_ARCHIVE}" "weekly"
fi

prune_local "${BACKUP_ROOT}/daily" "${BACKUP_RETENTION_DAILY}"
prune_local "${BACKUP_ROOT}/weekly" "${BACKUP_RETENTION_WEEKLY}"
prune_remote "daily" "${BACKUP_RETENTION_DAILY}"

if (( IS_WEEKLY == 1 )); then
  prune_remote "weekly" "${BACKUP_RETENTION_WEEKLY}"
fi

log "backup completed"
