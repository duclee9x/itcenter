#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker/compose.yaml"
export APP_ENV="${APP_ENV:-local}" HOST="${HOST:-127.0.0.1}" PORT="${PORT:-3000}" LOG_LEVEL="${LOG_LEVEL:-info}"
usage() { echo "Usage: npm run local -- {up|setup|start|status|restart|down}"; }
require_db() { [[ -n "${ITCENTER_LOCAL_DB_PASSWORD:-}" || -n "${ITCENTER_DATABASE_URL:-}" ]] || { echo "Set ITCENTER_LOCAL_DB_PASSWORD or ITCENTER_DATABASE_URL." >&2; exit 1; }; }
compose() { podman compose -f "$COMPOSE_FILE" "$@"; }
configure_db() {
  if [[ -z "${ITCENTER_DATABASE_URL:-}" ]]; then
    export ITCENTER_DATABASE_URL="postgres://itcenter:$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "${ITCENTER_LOCAL_DB_PASSWORD}")@127.0.0.1:5432/itcenter"
  fi
  export DATABASE_SECRET_REF="env:ITCENTER_DATABASE_URL"
}
up() { require_db; compose up -d; }
setup() { require_db; configure_db; up; npm run db:migrate; npm run db:seed; }
case "${1:-}" in
  up) up ;; setup) setup ;; start) setup; exec npm run start:api ;;
  status) compose ps; curl --fail --silent --show-error "http://${HOST}:${PORT}/api/v1/health/live" || true; echo ;;
  restart) require_db; compose down; setup ;; down) compose down ;;
  -h|--help|help) usage ;; *) usage >&2; exit 2 ;;
esac
