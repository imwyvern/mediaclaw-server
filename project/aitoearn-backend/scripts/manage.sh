#!/usr/bin/env bash
# MediaClaw Management Script
# Usage: ./manage.sh <command> [options]
# Commands: create|start|stop|status|upgrade-skill|logs|health

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE_PATH="${COMPOSE_FILE_PATH:-}"
SKILL_SERVICE_NAME="${SKILL_SERVICE_NAME:-}"
HEALTH_PATHS_RAW="${HEALTH_PATHS:-/api/v1/health /health}"
HEALTH_PORT_HINTS_RAW="${HEALTH_PORT_HINTS:-3000 3001 80 8080 8081 8000}"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_BIN=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN=(docker-compose)
else
  echo "Error: docker compose is not available." >&2
  exit 1
fi

COMPOSE_ARGS=()
if [[ -n "${COMPOSE_FILE_PATH}" ]]; then
  COMPOSE_ARGS=(-f "${COMPOSE_FILE_PATH}")
else
  for candidate in \
    "${PROJECT_ROOT}/compose.yaml" \
    "${PROJECT_ROOT}/compose.yml" \
    "${PROJECT_ROOT}/docker-compose.yaml" \
    "${PROJECT_ROOT}/docker-compose.yml"
  do
    if [[ -f "${candidate}" ]]; then
      COMPOSE_ARGS=(-f "${candidate}")
      break
    fi
  done
fi

IFS=' ' read -r -a HEALTH_PATHS <<< "${HEALTH_PATHS_RAW}"
IFS=' ' read -r -a HEALTH_PORT_HINTS <<< "${HEALTH_PORT_HINTS_RAW}"

print_usage() {
  cat <<'EOF'
Usage: ./manage.sh <command> [options]

Commands:
  create           docker compose up -d
  start            docker compose start
  stop             docker compose stop
  status           show running containers, port mapping, and health status
  upgrade-skill    pull latest skill image and restart skill container(s)
  logs [service]   tail logs for one service or all services
  health           curl health endpoints for discovered services

Environment overrides:
  COMPOSE_FILE_PATH   explicit compose file path
  SKILL_SERVICE_NAME  explicit skill service name
  HEALTH_PATHS        space-delimited health paths
  HEALTH_PORT_HINTS   space-delimited internal port hints
EOF
}

require_compose_file() {
  if [[ ${#COMPOSE_ARGS[@]} -eq 0 ]]; then
    echo "Error: no compose file found. Set COMPOSE_FILE_PATH or add compose.yaml/docker-compose.yml." >&2
    exit 1
  fi
}

compose() {
  require_compose_file
  (
    cd "${PROJECT_ROOT}"
    "${COMPOSE_BIN[@]}" "${COMPOSE_ARGS[@]}" "$@"
  )
}

list_services() {
  compose config --services
}

service_container_id() {
  local service="$1"
  compose ps -q "${service}" 2>/dev/null | head -n 1
}

service_health() {
  local service="$1"
  local container_id
  container_id="$(service_container_id "${service}")"

  if [[ -z "${container_id}" ]]; then
    echo "not-running"
    return 0
  fi

  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "${container_id}" 2>/dev/null || echo "unknown"
}

show_ports() {
  local service="$1"
  local found="false"

  for port in "${HEALTH_PORT_HINTS[@]}"; do
    local mapping
    mapping="$(compose port "${service}" "${port}" 2>/dev/null || true)"
    if [[ -n "${mapping}" ]]; then
      found="true"
      printf '  - %s -> %s\n' "${port}" "${mapping}"
    fi
  done

  if [[ "${found}" != "true" ]]; then
    echo "  - no published ports detected from configured hints"
  fi
}

check_health_for_service() {
  local service="$1"
  local attempted="false"

  for port in "${HEALTH_PORT_HINTS[@]}"; do
    local mapping
    mapping="$(compose port "${service}" "${port}" 2>/dev/null || true)"
    if [[ -z "${mapping}" ]]; then
      continue
    fi

    local host_port="${mapping##*:}"
    for path in "${HEALTH_PATHS[@]}"; do
      attempted="true"
      local url="http://127.0.0.1:${host_port}${path}"
      if output="$(curl --fail --silent --show-error --max-time 5 "${url}" 2>/dev/null)"; then
        echo "[ok] ${service} ${url}"
        echo "${output}"
        return 0
      fi
    done
  done

  if [[ "${attempted}" == "true" ]]; then
    echo "[warn] ${service} no responsive health endpoint found"
  else
    echo "[warn] ${service} no mapped ports matched HEALTH_PORT_HINTS"
  fi

  return 1
}

upgrade_skill() {
  local services=()

  if [[ -n "${SKILL_SERVICE_NAME}" ]]; then
    services=("${SKILL_SERVICE_NAME}")
  else
    while IFS= read -r service; do
      [[ -n "${service}" ]] || continue
      services+=("${service}")
    done < <(list_services | grep 'skill' || true)
  fi

  if [[ ${#services[@]} -eq 0 ]]; then
    echo "Error: no skill service found. Set SKILL_SERVICE_NAME to override." >&2
    exit 1
  fi

  compose pull "${services[@]}"
  compose up -d "${services[@]}"
}

status() {
  compose ps
  echo
  echo "Port Mapping:"
  while IFS= read -r service; do
    [[ -n "${service}" ]] || continue
    echo "${service}:"
    show_ports "${service}"
    echo "  - health: $(service_health "${service}")"
  done < <(list_services)
}

health() {
  local exit_code=0

  while IFS= read -r service; do
    [[ -n "${service}" ]] || continue
    if ! check_health_for_service "${service}"; then
      exit_code=1
    fi
  done < <(list_services)

  return "${exit_code}"
}

main() {
  local command="${1:-}"
  case "${command}" in
    create)
      compose up -d
      ;;
    start)
      compose start
      ;;
    stop)
      compose stop
      ;;
    status)
      status
      ;;
    upgrade-skill)
      upgrade_skill
      ;;
    logs)
      shift || true
      if [[ $# -gt 0 ]]; then
        compose logs -f "$1"
      else
        compose logs -f
      fi
      ;;
    health)
      health
      ;;
    ""|-h|--help|help)
      print_usage
      ;;
    *)
      echo "Error: unknown command '${command}'." >&2
      print_usage
      exit 1
      ;;
  esac
}

main "$@"
