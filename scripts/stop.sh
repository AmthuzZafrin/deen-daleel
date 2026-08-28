#!/usr/bin/env bash
# Stop what scripts/start.sh started.
#
# The database is left running by default: it holds the corpus and the answer
# bank, starting it again is the slowest part of a cold start, and an idle
# Postgres costs nothing. Pass --all to stop it too.
#
# Usage: scripts/stop.sh [--all]

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Matched on the command line rather than a pidfile: these are started with
# nohup from a shell that exits immediately, so there is no reliable pid to keep.
# The pattern is the script name alone -- start.sh launches it from `ingest/` so
# the command line is relative, and matching an absolute path finds nothing.
pkill -f "serve_embeddings.py" 2>/dev/null \
  && echo "stopped embedding service" || echo "embedding service was not running"

pkill -f "next dev" 2>/dev/null \
  && echo "stopped web app" || echo "web app was not running"

if [ "${1:-}" = "--all" ]; then
  "$ROOT/scripts/db.sh" down >/dev/null 2>&1 && echo "stopped database"
else
  echo "database left running (scripts/stop.sh --all to stop it too)"
fi
