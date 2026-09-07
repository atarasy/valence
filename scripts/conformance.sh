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

if [ ! -d "$TESTS" ]; then
  echo "conformance suites not found at $TESTS" >&2
  echo "set ATARAXIA_TESTS to the tests directory of the ataraxia repository" >&2
  exit 1
fi

cd "$HERE"
PORT="$PORT" VALENCE_EXPLORATION_RATE="${VALENCE_EXPLORATION_RATE:-0.2}" \
  bun run src/server.ts &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "$BASE/offers?household=probe" 2>/dev/null; then break; fi
  sleep 0.1
done

curl -fsS -X POST "$BASE/_presenter/configs" \
  -H 'content-type: application/json' \
  -d '{
        "version": "cfg-conformance",
        "presenter": "reference-merchant",
        "products": {
          "tea-a":    {"price": 1200, "cost": 400},
          "tea-b":    {"price":  900, "cost": 300},
          "coffee-a": {"price": 1500, "cost": 600},
          "miso-a":   {"price":  700, "cost": 250},
          "nori-a":   {"price": 1100, "cost": 380}
        }
      }' > /dev/null

cd "$TESTS"
VALENCE_BASE_URL="$BASE" \
VALENCE_CONFIG_VERSION="cfg-conformance" \
VALENCE_HOUSEHOLD="household-conformance" \
VALENCE_MANDATE="mandate-conformance" \
VALENCE_PRODUCTS="tea-a,tea-b,coffee-a,miso-a,nori-a" \
VALENCE_EXPLORATION_RATE="${VALENCE_EXPLORATION_RATE:-0.2}" \
  bun test absence floor silence
