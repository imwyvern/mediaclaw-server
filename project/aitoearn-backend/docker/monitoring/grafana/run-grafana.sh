set -eu

# Docker Desktop on macOS can introduce AppleDouble sidecar files when syncing
# monitoring assets. Remove them before Grafana scans provisioning directories.
find /etc/grafana/provisioning -name '._*' -delete 2>/dev/null || true
find /etc/grafana/dashboards -name '._*' -delete 2>/dev/null || true

exec /run.sh
