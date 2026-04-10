#!/usr/bin/env bash
set -Eeuo pipefail

RESTORE_SOURCE="${RESTORE_SOURCE:-}"
RESTORE_MONGODB_URI="${RESTORE_MONGODB_URI:-}"
RESTORE_DOWNLOAD_DIR="${RESTORE_DOWNLOAD_DIR:-/tmp/mediaclaw-restore}"
RESTORE_KEEP_DOWNLOAD="${RESTORE_KEEP_DOWNLOAD:-0}"
TEMP_ARCHIVE=""

log() {
  printf '[restore] %s\n' "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'missing required command: %s\n' "$1" >&2
    exit 1
  }
}

cleanup() {
  if [[ -n "${TEMP_ARCHIVE}" && "${RESTORE_KEEP_DOWNLOAD}" != "1" ]]; then
    rm -f "${TEMP_ARCHIVE}"
  fi
}

download_archive() {
  local source="$1"
  local filename

  mkdir -p "${RESTORE_DOWNLOAD_DIR}"
  filename="$(basename "${source}")"
  TEMP_ARCHIVE="${RESTORE_DOWNLOAD_DIR%/}/${filename}"

  case "${source}" in
    s3://*)
      require_cmd aws
      aws s3 cp "${source}" "${TEMP_ARCHIVE}"
      ;;
    oss://*)
      require_cmd ossutil
      ossutil cp "${source}" "${TEMP_ARCHIVE}"
      ;;
    *)
      printf 'unsupported RESTORE_SOURCE scheme: %s\n' "${source}" >&2
      exit 1
      ;;
  esac

  printf '%s\n' "${TEMP_ARCHIVE}"
}

resolve_archive() {
  local source="$1"

  case "${source}" in
    s3://*|oss://*)
      download_archive "${source}"
      ;;
    *)
      if [[ ! -f "${source}" ]]; then
        printf 'restore archive not found: %s\n' "${source}" >&2
        exit 1
      fi

      printf '%s\n' "${source}"
      ;;
  esac
}

trap cleanup EXIT

require_cmd mongorestore

if [[ -z "${RESTORE_SOURCE}" ]]; then
  printf 'RESTORE_SOURCE is required\n' >&2
  exit 1
fi

if [[ -z "${RESTORE_MONGODB_URI}" ]]; then
  printf 'RESTORE_MONGODB_URI is required\n' >&2
  exit 1
fi

ARCHIVE_PATH="$(resolve_archive "${RESTORE_SOURCE}")"

log "restoring mongodb archive ${ARCHIVE_PATH}"
mongorestore --uri="${RESTORE_MONGODB_URI}" --archive="${ARCHIVE_PATH}" --gzip --drop
log "restore completed"
