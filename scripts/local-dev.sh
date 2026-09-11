#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker/compose.yaml"
export APP_ENV="${APP_ENV:-local}" HOST="${HOST:-127.0.0.1}" PORT="${PORT:-3000}" LOG_LEVEL="${LOG_LEVEL:-info}"
usage() { echo "Usage: npm run local -- {up|setup|start|serve|status|restart|down|backup|restore|backup-loop}"; }
require_db() { [[ -n "${ITCENTER_LOCAL_DB_PASSWORD:-}" || -n "${ITCENTER_DATABASE_URL:-}" ]] || { echo "Set ITCENTER_LOCAL_DB_PASSWORD or ITCENTER_DATABASE_URL." >&2; exit 1; }; }
compose() { podman compose -f "$COMPOSE_FILE" "$@"; }
database_port() {
  local published
  published="$(podman port itcenter-postgres 5432/tcp 2>/dev/null | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p' | head -n 1)"
  echo "${published:-5432}"
}
configure_db() {
  if [[ -z "${ITCENTER_DATABASE_URL:-}" ]]; then
    export ITCENTER_DATABASE_URL="postgres://itcenter:$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "${ITCENTER_LOCAL_DB_PASSWORD}")@127.0.0.1:$(database_port)/itcenter"
  fi
  export DATABASE_SECRET_REF="env:ITCENTER_DATABASE_URL"
}
up() {
  if podman inspect itcenter-postgres --format '{{.State.Running}}' 2>/dev/null | grep -q '^true$'; then
    return
  fi
  [[ -n "${ITCENTER_LOCAL_DB_PASSWORD:-}" ]] || { echo "Set ITCENTER_LOCAL_DB_PASSWORD to start PostgreSQL, or start itcenter-postgres first." >&2; exit 1; }
  compose up -d
}
setup() { require_db; configure_db; up; npm run db:migrate; npm run db:seed; }
serve() { require_db; configure_db; up; exec npm run start:api; }
backup() {
  require_db; configure_db; up
  local output="${2:-$ROOT_DIR/backups/itcenter-$(date +%Y%m%d-%H%M%S).dump}"
  mkdir -p "$(dirname "$output")"
  podman exec -e PGPASSWORD="${ITCENTER_LOCAL_DB_PASSWORD:-}" itcenter-postgres pg_dump -U itcenter -d itcenter -Fc > "$output"
  echo "Backup written to $output"
}
restore() {
  require_db; configure_db
  [[ "${3:-}" == "--confirm" ]] || { echo "Restore overwrites database objects. Add --confirm." >&2; exit 2; }
  [[ -f "${2:-}" ]] || { echo "Backup file not found: ${2:-}" >&2; exit 1; }
  up
  podman exec -i -e PGPASSWORD="${ITCENTER_LOCAL_DB_PASSWORD:-}" itcenter-postgres pg_restore -U itcenter -d itcenter --clean --if-exists --no-owner < "$2"
}
backup_loop() {
  local interval="${2:-86400}"
  while true; do backup; sleep "$interval"; done
}
case "${1:-}" in
  up) up ;; setup) setup ;; start) setup; exec npm run start:api ;; serve) serve ;;
  status) compose ps; curl --fail --silent --show-error "http://${HOST}:${PORT}/api/v1/health/live" || true; echo ;;
  restart) require_db; compose down; setup ;; down) compose down ;;
  backup) backup "$@" ;; restore) restore "$@" ;; backup-loop) backup_loop "$@" ;;
  -h|--help|help) usage ;; *) usage >&2; exit 2 ;;
esac
