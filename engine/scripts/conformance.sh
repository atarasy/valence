#!/usr/bin/env bash
# Start the reference implementation, seed a presenter catalogue, and run the
# Ataraxia conformance suites against it over HTTP.
#
# The suites import nothing from this repository. Everything they need arrives
# as the six environment variables exported below, which is what lets the same
# suites run against an implementation written in any language.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS="${ATARAXIA_TESTS:-$HOME/Documents/GitHub/ataraxia/tests}"
PORT="${PORT:-8788}"
BASE="http://localhost:${PORT}"

if lsof -ti ":${PORT}" >/dev/null 2>&1; then
  echo "port ${PORT} is already in use; a previous run is still listening" >&2
  echo "stop it, or set PORT to a free one" >&2
  exit 1
fi

if [ ! -d "$TESTS" ]; then
  echo "conformance suites not found at $TESTS" >&2
  echo "set ATARAXIA_TESTS to the tests directory of the ataraxia repository" >&2
  exit 1
fi

cd "$HERE"
PORT="$PORT" VALENCE_EXPLORATION_RATE="${VALENCE_EXPLORATION_RATE:-0.2}" \
  bun src/server.ts &
SERVER_PID=$!
# PIPE matters: piping this script into `tail` kills it before an EXIT-only
# trap runs, and the server outlives the run and blocks the next one.
cleanup() {
  # Killing $SERVER_PID alone is not enough. `bun run` forks a child the trap
  # cannot see, and a pipeline into `tail` kills this script by SIGPIPE before
  # an EXIT-only trap fires. Either way the server outlives the run and the
  # next run refuses to start, which reads as a broken suite rather than a
  # stale process. So the port is what gets cleared, not a remembered pid.
  kill "$SERVER_PID" 2>/dev/null || true
  lsof -ti ":${PORT}" 2>/dev/null | while read -r pid; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM HUP PIPE

for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "$BASE/offers?household=probe" 2>/dev/null; then break; fi
  sleep 0.1
done

EDGE="$(BASE="$BASE" bun scripts/seed.ts)"

cd "$TESTS"
VALENCE_BASE_URL="$BASE" \
VALENCE_CONFIG_VERSION="cfg-conformance" \
VALENCE_HOUSEHOLD="household-conformance" \
VALENCE_MANDATE="mandate-conformance" \
VALENCE_PRODUCTS="tea-a,tea-b,coffee-a,miso-a,nori-a" \
VALENCE_EXPLORATION_RATE="${VALENCE_EXPLORATION_RATE:-0.2}" \
VALENCE_LINEAGE_EDGE="$EDGE" \
VALENCE_PRICES='{"tea-a":1200,"tea-b":900,"coffee-a":1500,"miso-a":700,"nori-a":1100}' \
VALENCE_BINDINGS="digital,physical" \
VALENCE_CONFIG_VERSION_LATER="cfg-conformance-v2" \
VALENCE_PRICES_LATER='{"tea-a":9900,"tea-b":900,"coffee-a":1500,"miso-a":700,"nori-a":1100}' \
  bun test ${SUITES:-absence floor silence lineage opacity binding}
