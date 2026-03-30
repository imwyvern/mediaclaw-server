#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.production.yml"
ENV_FILE="${ROOT_DIR}/.env.production"
CONTEXT_OUTPUT="${ROOT_DIR}/tmp/docker-context/aitoearn-server"
REMOTE="${DEPLOY_GIT_REMOTE:-origin}"
BRANCH="${DEPLOY_GIT_BRANCH:-$(git -C "${ROOT_DIR}" branch --show-current)}"
ROLLBACK_OVERRIDE=""
ROLLED_BACK=0

log() {
  printf '[deploy] %s\n' "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'missing required command: %s\n' "$1" >&2
    exit 1
  }
}

capture_image_id() {
  local service="$1"
  local container_id
  container_id="$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps -q "${service}" 2>/dev/null || true)"
  if [[ -z "${container_id}" ]]; then
    return 0
  fi

  docker inspect --format '{{.Image}}' "${container_id}" 2>/dev/null || true
}

wait_for_service_health() {
  local service="$1"
  local timeout="${2:-180}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local container_id status
    container_id="$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps -q "${service}" 2>/dev/null || true)"
    if [[ -n "${container_id}" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
      if [[ "${status}" == "healthy" ]]; then
        log "service ${service} is healthy"
        return 0
      fi
      if [[ "${status}" == "exited" || "${status}" == "dead" ]]; then
        log "service ${service} entered unexpected state: ${status}"
        docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=200 "${service}" || true
        return 1
      fi
    fi

    if (( "$(date +%s)" - started_at >= timeout )); then
      log "service ${service} did not become healthy within ${timeout}s"
      docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=200 "${service}" || true
      return 1
    fi

    sleep 5
  done
}

rollback() {
  if [[ "${ROLLED_BACK}" -eq 1 ]]; then
    return
  fi
  ROLLED_BACK=1

  log "deployment failed, rolling back to ${PREVIOUS_HEAD}"
  git -C "${ROOT_DIR}" reset --hard "${PREVIOUS_HEAD}"

  if [[ -n "${ROLLBACK_OVERRIDE}" && -f "${ROLLBACK_OVERRIDE}" ]]; then
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" -f "${ROLLBACK_OVERRIDE}" up -d --no-build api worker nginx || true
  fi
}

cleanup() {
  if [[ -n "${ROLLBACK_OVERRIDE}" && -f "${ROLLBACK_OVERRIDE}" ]]; then
    rm -f "${ROLLBACK_OVERRIDE}"
  fi
}

trap rollback ERR
trap cleanup EXIT

require_cmd git
require_cmd node
require_cmd docker
require_cmd curl

if [[ ! -f "${ENV_FILE}" ]]; then
  printf '.env.production is required. copy from .env.production.example and fill the secrets first.\n' >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

PREVIOUS_HEAD="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
PREVIOUS_API_IMAGE_ID="$(capture_image_id api)"
PREVIOUS_WORKER_IMAGE_ID="$(capture_image_id worker)"

mkdir -p "${ROOT_DIR}/tmp"
ROLLBACK_OVERRIDE="$(mktemp "${ROOT_DIR}/tmp/deploy-rollback.XXXXXX.yml")"
cat > "${ROLLBACK_OVERRIDE}" <<EOF
services:
EOF

if [[ -n "${PREVIOUS_API_IMAGE_ID}" ]]; then
  cat >> "${ROLLBACK_OVERRIDE}" <<EOF
  api:
    image: ${PREVIOUS_API_IMAGE_ID}
EOF
fi

if [[ -n "${PREVIOUS_WORKER_IMAGE_ID}" ]]; then
  cat >> "${ROLLBACK_OVERRIDE}" <<EOF
  worker:
    image: ${PREVIOUS_WORKER_IMAGE_ID}
EOF
fi

log "pulling latest code from ${REMOTE}/${BRANCH}"
git -C "${ROOT_DIR}" fetch "${REMOTE}" "${BRANCH}"
git -C "${ROOT_DIR}" pull --ff-only "${REMOTE}" "${BRANCH}"

log "preparing docker context"
node "${ROOT_DIR}/scripts/build-docker.mjs" aitoearn-server --output "${CONTEXT_OUTPUT}" --context-only

log "validating compose configuration"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config -q

log "starting infrastructure services"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d mongodb redis rustfs
wait_for_service_health mongodb 180
wait_for_service_health redis 120
wait_for_service_health rustfs 240

log "building application images"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build api worker

if [[ -n "${MIGRATION_CMD:-}" ]]; then
  log "running migration command"
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm api sh -lc "${MIGRATION_CMD}"
fi

log "starting application services"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d api worker nginx
wait_for_service_health api 240
wait_for_service_health worker 240
wait_for_service_health nginx 120

log "verifying public health endpoint"
curl --fail --silent "http://127.0.0.1:${NGINX_HTTP_PORT:-80}/health" >/dev/null

trap - ERR
log "deployment completed successfully"
