#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="${DEPLOY_SERVER:-root@8.129.133.52}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/mediaclaw/web}"
PM2_APP_NAME="${DEPLOY_PM2_APP_NAME:-mediaclaw-web}"
REMOTE_PORT="${DEPLOY_PORT:-3001}"
ARTIFACT_PATH="${DEPLOY_ARTIFACT_PATH:-${TMPDIR:-/tmp}/mediaclaw-web-standalone.tar.gz}"
REMOTE_ARTIFACT_PATH="/tmp/$(basename "${ARTIFACT_PATH}")"
RELEASE_NAME="${DEPLOY_RELEASE_NAME:-$(date +%Y%m%d%H%M%S)}"

SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o ServerAliveInterval=5
  -o ServerAliveCountMax=3
)

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

cleanup() {
  rm -f "${ARTIFACT_PATH}"
}

trap cleanup EXIT

main() {
  require_cmd pnpm
  require_cmd tar
  require_cmd ssh
  require_cmd scp
  require_cmd curl

  (
    cd "${ROOT_DIR}"
    pnpm build:standalone
    COPYFILE_DISABLE=1 tar czf "${ARTIFACT_PATH}" -C "${ROOT_DIR}/.deploy/standalone" .
  )

  scp "${SSH_OPTS[@]}" "${ARTIFACT_PATH}" "${SERVER}:${REMOTE_ARTIFACT_PATH}"

  ssh "${SSH_OPTS[@]}" "${SERVER}" "$(cat <<EOF
set -Eeuo pipefail
mkdir -p "${REMOTE_DIR}/releases/${RELEASE_NAME}"
tar xzf "${REMOTE_ARTIFACT_PATH}" -C "${REMOTE_DIR}/releases/${RELEASE_NAME}"
ln -sfn "${REMOTE_DIR}/releases/${RELEASE_NAME}" "${REMOTE_DIR}/current"
cd "${REMOTE_DIR}/current"
PORT="${REMOTE_PORT}" HOSTNAME="0.0.0.0" PM2_APP_NAME="${PM2_APP_NAME}" pm2 startOrReload ecosystem.config.cjs --only "${PM2_APP_NAME}" --update-env
pm2 save
sleep 5
curl --fail --silent --max-time 10 "http://127.0.0.1:${REMOTE_PORT}" >/dev/null
rm -f "${REMOTE_ARTIFACT_PATH}"
EOF
)"

  echo "frontend deployed to ${SERVER}:${REMOTE_DIR}/current"
}

main "$@"
