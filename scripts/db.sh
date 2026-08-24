#!/usr/bin/env bash
# Postgres + pgvector lifecycle, using plain `docker run`.
#
# This machine has the Docker engine but no `docker compose` plugin, so this
# script is the supported path here. docker-compose.yml is kept in the repo for
# environments that do have it — both produce an identical container.
#
# Usage: scripts/db.sh {up|down|psql|migrate|reset|logs|status}

set -euo pipefail

NAME="${DEEN_DB_CONTAINER:-deen-daleel-db}"
VOLUME="${DEEN_DB_VOLUME:-deen-daleel-pgdata}"
IMAGE="pgvector/pgvector:pg17"
PORT="${DEEN_DB_PORT:-5433}"
DB="deen_daleel"
USER="deen"
PASS="deen"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# psql runs *inside* the container, so no local client version is required
# (the host's psql here is 14 and would warn against a 17 server).
in_db() { docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -U "$USER" -d "$DB" "$@"; }

wait_ready() {
  printf 'waiting for postgres'
  for _ in $(seq 1 60); do
    if docker exec "$NAME" pg_isready -U "$USER" -d "$DB" >/dev/null 2>&1; then
      printf ' ready\n'; return 0
    fi
    printf '.'; sleep 1
  done
  printf '\ntimed out waiting for postgres\n' >&2; return 1
}

case "${1:-}" in
  up)
    if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
      docker start "$NAME" >/dev/null
      echo "started existing container $NAME"
    else
      docker volume create "$VOLUME" >/dev/null
      docker run -d \
        --name "$NAME" \
        -e POSTGRES_DB="$DB" \
        -e POSTGRES_USER="$USER" \
        -e POSTGRES_PASSWORD="$PASS" \
        -p "127.0.0.1:${PORT}:5432" \
        -v "$VOLUME:/var/lib/postgresql/data" \
        --health-cmd="pg_isready -U $USER -d $DB" \
        --health-interval=5s \
        "$IMAGE" >/dev/null
      echo "created container $NAME"
    fi
    wait_ready
    echo "DATABASE_URL=postgresql://${USER}:${PASS}@localhost:${PORT}/${DB}"
    ;;

  migrate)
    wait_ready
    shopt -s nullglob
    files=("$ROOT"/db/migrations/*.sql)
    if [ ${#files[@]} -eq 0 ]; then echo "no migrations found" >&2; exit 1; fi

    # Migrations are not written to be re-runnable, so applied ones are
    # recorded and skipped. Without this the first file fails on its second
    # run ("relation already exists") and, under ON_ERROR_STOP, every later
    # migration silently never runs.
    in_db -q -c 'create table if not exists schema_migrations (
                   filename text primary key,
                   applied_at timestamptz not null default now())'

    for f in "${files[@]}"; do
      base="$(basename "$f")"
      if [ "$(in_db -tAc "select 1 from schema_migrations where filename = '$base'")" = "1" ]; then
        echo "skipping $base (already applied)"
        continue
      fi
      echo "applying $base"
      in_db < "$f"
      in_db -q -c "insert into schema_migrations (filename) values ('$base')"
    done
    echo "--- extensions ---"
    in_db -c '\dx'
    echo "--- tables ---"
    in_db -c '\dt'
    ;;

  psql)   docker exec -it "$NAME" psql -U "$USER" -d "$DB" ;;
  logs)   docker logs -f "$NAME" ;;
  status) docker ps -a --filter "name=$NAME" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' ;;
  down)   docker stop "$NAME" >/dev/null 2>&1 || true; echo "stopped $NAME" ;;

  reset)
    read -rp "Destroy all data in $VOLUME? [y/N] " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "aborted"; exit 1; }
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker volume rm "$VOLUME" >/dev/null 2>&1 || true
    echo "removed container and volume; run 'scripts/db.sh up' to recreate"
    ;;

  *)
    echo "usage: scripts/db.sh {up|down|psql|migrate|reset|logs|status}" >&2
    exit 1
    ;;
esac
