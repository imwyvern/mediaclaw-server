#!/bin/bash
# MediaClaw Instance Manager
# Usage: ./manage.sh <command> [client-slug]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_DIR="${PROJECT_ROOT}/deploy"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.mediaclaw.yml"

usage() {
    echo "MediaClaw Instance Manager"
    echo ""
    echo "Usage: $0 <command> [client-slug]"
    echo ""
    echo "Commands:"
    echo "  create <slug>    Create a new client instance"
    echo "  start [slug]     Start services (all or specific client)"
    echo "  stop [slug]      Stop services"
    echo "  status [slug]    Show service status"
    echo "  logs [slug]      Tail logs"
    echo "  upgrade-skill    Update mediaclaw-client skill on all instances"
    echo ""
    echo "Examples:"
    echo "  $0 create jinbantang"
    echo "  $0 start"
    echo "  $0 logs jinbantang"
}

create_instance() {
    local slug="$1"
    if [ -z "$slug" ]; then
        echo "Error: client slug required"
        exit 1
    fi

    local instance_dir="${DEPLOY_DIR}/instances/${slug}"
    mkdir -p "$instance_dir"

    # Copy env template
    if [ ! -f "$instance_dir/.env" ]; then
        cp "${PROJECT_ROOT}/.env.example" "$instance_dir/.env"
        sed -i '' "s/mediaclaw/${slug}/g" "$instance_dir/.env" 2>/dev/null || true
        echo "Created .env for ${slug} at ${instance_dir}/.env"
        echo "⚠️  Edit ${instance_dir}/.env with real credentials before starting"
    else
        echo ".env already exists for ${slug}"
    fi

    # Create docker-compose override
    cat > "$instance_dir/docker-compose.override.yml" << EOF
version: '3.8'
services:
  mongodb:
    container_name: ${slug}-mongodb
  redis:
    container_name: ${slug}-redis
  minio:
    container_name: ${slug}-minio
  api:
    container_name: ${slug}-api
    env_file:
      - ${instance_dir}/.env
EOF

    echo "✅ Instance '${slug}' created at ${instance_dir}"
    echo "   Next: edit .env, then run: $0 start ${slug}"
}

start_services() {
    local slug="$1"
    if [ -n "$slug" ]; then
        local instance_dir="${DEPLOY_DIR}/instances/${slug}"
        docker compose -f "$COMPOSE_FILE" -f "$instance_dir/docker-compose.override.yml" up -d
    else
        docker compose -f "$COMPOSE_FILE" up -d
    fi
    echo "✅ Services started"
}

stop_services() {
    local slug="$1"
    if [ -n "$slug" ]; then
        local instance_dir="${DEPLOY_DIR}/instances/${slug}"
        docker compose -f "$COMPOSE_FILE" -f "$instance_dir/docker-compose.override.yml" down
    else
        docker compose -f "$COMPOSE_FILE" down
    fi
    echo "✅ Services stopped"
}

show_status() {
    local slug="$1"
    if [ -n "$slug" ]; then
        docker ps --filter "name=${slug}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    else
        docker compose -f "$COMPOSE_FILE" ps
    fi
}

show_logs() {
    local slug="$1"
    if [ -n "$slug" ]; then
        docker logs -f "${slug}-api" 2>&1
    else
        docker compose -f "$COMPOSE_FILE" logs -f api
    fi
}

upgrade_skill() {
    echo "Upgrading mediaclaw-client skill on all instances..."
    # TODO: Implement skill upgrade via ClawHost API or direct container exec
    echo "⚠️  Not yet implemented — requires ClawHost (Sprint 6)"
}

case "${1:-}" in
    create)   create_instance "$2" ;;
    start)    start_services "$2" ;;
    stop)     stop_services "$2" ;;
    status)   show_status "$2" ;;
    logs)     show_logs "$2" ;;
    upgrade-skill) upgrade_skill ;;
    *)        usage ;;
esac
