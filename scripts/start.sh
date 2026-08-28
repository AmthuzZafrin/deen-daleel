#!/usr/bin/env bash
# Bring the whole app up and open it in a browser.
#
# Three processes have to be running before a question can be answered, and the
# failure when one is missing is not obvious from the page: without Postgres
# nothing loads at all, but without the embedding service the site looks fine
# and every question misses, which reads as "the answer bank is empty" rather
# than "a service is down". So this starts all three, waits for each to actually
# respond, and says which one failed if one does.
#
# Safe to re-run. Anything already up is left alone rather than restarted.
#
# Usage: scripts/start.sh [--no-browser]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/.logs"
PORT=3000
EMBED_PORT=8001

mkdir -p "$LOGS"

# Start a server detached from this terminal.
#
# `setsid` and the three redirections together are what make it detached: a new
# session so closing the terminal does not take the server with it, and no
# inherited stdin, stdout or stderr. The last part matters more than it looks --
# a child that still holds this script's stdout keeps the pipe open, so
# `scripts/start.sh | tail` would sit there looking hung until the dev server
# exited, which is the opposite of what a start script should do.
# Usage: spawn <logfile> <command...>
spawn() {
  local log="$1"; shift
  setsid "$@" >"$log" 2>&1 </dev/null &
  disown 2>/dev/null || true
}

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mok\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAILED\033[0m  %s\n' "$1" >&2; }

# Poll a URL until it answers. Returns non-zero on timeout so the caller can
# print the log tail rather than opening a browser onto a broken page.
wait_http() {
  local url="$1" name="$2" tries="${3:-60}"
  printf '  waiting for %s' "$name"
  for _ in $(seq 1 "$tries"); do
    if curl -sf -o /dev/null --max-time 2 "$url"; then printf '\n'; ok "$name"; return 0; fi
    printf '.'; sleep 1
  done
  printf '\n'; fail "$name did not come up"; return 1
}

# --- 1. Postgres ------------------------------------------------------------

step "1/3  database"
"$ROOT/scripts/db.sh" up >/dev/null
if docker exec deen-daleel-db pg_isready -U deen -d deen_daleel >/dev/null 2>&1; then
  ok "postgres on :5433"
else
  fail "postgres"; exit 1
fi

# --- 2. Embeddings ----------------------------------------------------------
#
# This one loads BGE-M3 onto the GPU and takes the longest -- around 20 seconds
# from cold. It is started before the web server so the two warm up in parallel.

step "2/3  embedding service"
if curl -sf -o /dev/null --max-time 2 "http://localhost:$EMBED_PORT/health"; then
  ok "already running on :$EMBED_PORT"
else
  ( cd "$ROOT/ingest" && spawn "$LOGS/embeddings.log" \
      .venv/bin/python serve_embeddings.py )
  wait_http "http://localhost:$EMBED_PORT/health" "embeddings on :$EMBED_PORT" 90 || {
    tail -20 "$LOGS/embeddings.log" >&2; exit 1; }
fi

# --- 3. The site ------------------------------------------------------------

step "3/3  web app"
if curl -sf -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
  ok "already running on :$PORT"
else
  ( cd "$ROOT/web" && spawn "$LOGS/web.log" npm run dev )
  wait_http "http://localhost:$PORT/" "app on :$PORT" 90 || {
    tail -20 "$LOGS/web.log" >&2; exit 1; }
fi

# --- ready ------------------------------------------------------------------

printf '\n\033[1mReady:\033[0m http://localhost:%s\n' "$PORT"
printf 'Logs:  %s/{embeddings,web}.log\n' "$LOGS"
printf 'Stop:  scripts/stop.sh\n\n'

if [ "${1:-}" != "--no-browser" ]; then
  # Backgrounded and silenced: xdg-open holds the terminal on some desktops,
  # and a missing browser should not fail a start that otherwise worked.
  (xdg-open "http://localhost:$PORT" >/dev/null 2>&1 &) || true
fi
