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
PORT="$PORT" VALENCE_RECOVERY_GRACE_DAYS=0 VALENCE_RP_ID=conformance.example VALENCE_EXPLORATION_RATE="${VALENCE_EXPLORATION_RATE:-0.2}" \
  bun src/server.ts &
SERVER_PID=$!

# A second host, so `exit/` has somewhere to move a node to. Clause 61 says a
# member can move an entire node, and a suite with one host can only check that
# a file was produced.
SECOND_PORT=$((PORT + 100))
SECOND="http://localhost:${SECOND_PORT}"
PORT="$SECOND_PORT" VALENCE_RECOVERY_GRACE_DAYS=0 VALENCE_RP_ID=conformance.example VALENCE_EXPLORATION_RATE="${VALENCE_EXPLORATION_RATE:-0.2}" \
  bun src/server.ts &
SECOND_PID=$!

# §13.1. Two more servers, each presenting one role, so the suites can ask what
# a hub alone and an engine alone answer for. Without them the split is real in
# the code and invisible to a probe, which is the state the split exists to
# leave behind.
ENGINE_ONLY_PORT=$((PORT + 200))
ENGINE_ONLY="http://localhost:${ENGINE_ONLY_PORT}"
HUB_ONLY_PORT=$((PORT + 300))
HUB_ONLY="http://localhost:${HUB_ONLY_PORT}"

# The engine-only process holds no mandates and is told where the hub is, which
# is §13.1's interface: it asks over the endpoints rather than reading a store
# it does not own. The URL is known before either starts, and the engine only
# calls it when an offer needs a protection, so the order of these two lines
# does not matter.
PORT="$ENGINE_ONLY_PORT" VALENCE_ROLES=engine VALENCE_HUB_URL="$HUB_ONLY" VALENCE_RECOVERY_GRACE_DAYS=0 VALENCE_RP_ID=conformance.example VALENCE_EXPLORATION_RATE="${VALENCE_EXPLORATION_RATE:-0.2}" \
  bun src/server.ts &
ENGINE_ONLY_PID=$!

PORT="$HUB_ONLY_PORT" VALENCE_ROLES=hub VALENCE_RECOVERY_GRACE_DAYS=0 VALENCE_RP_ID=conformance.example VALENCE_EXPLORATION_RATE="${VALENCE_EXPLORATION_RATE:-0.2}" \
  bun src/server.ts &
HUB_ONLY_PID=$!
# PIPE matters: piping this script into `tail` kills it before an EXIT-only
# trap runs, and the server outlives the run and blocks the next one.
cleanup() {
  # Killing $SERVER_PID alone is not enough. `bun run` forks a child the trap
  # cannot see, and a pipeline into `tail` kills this script by SIGPIPE before
  # an EXIT-only trap fires. Either way the server outlives the run and the
  # next run refuses to start, which reads as a broken suite rather than a
  # stale process. So the port is what gets cleared, not a remembered pid.
  #
  # Under `pipefail` an `lsof` that finds nothing returns 1, which is the
  # ordinary case once the kill above has worked, and `set -e` then terminates
  # the shell from inside this trap. (It is NOT that a trap's return status
  # becomes the script's status; bash does not do that, and an earlier version
  # of this comment said so wrongly.) Measured 2026-09-09: the script exited 1
  # on every clean run from the commit that added this loop, and mutate.sh
  # reads that status, so its SURVIVED branch could not fire and a mutation
  # caught by nothing was reported as though it had been caught. `set -e` also
  # abandoned the loop on its first iteration, so the second port was never
  # swept here. Hence `|| true` on the pipeline and an explicit success below.
  kill "$SERVER_PID" 2>/dev/null || true
  kill "${SECOND_PID:-0}" 2>/dev/null || true
  kill "${ENGINE_ONLY_PID:-0}" 2>/dev/null || true
  kill "${HUB_ONLY_PID:-0}" 2>/dev/null || true
  for p in "${PORT}" "$((PORT + 100))" "$((PORT + 200))" "$((PORT + 300))"; do
    { lsof -ti ":${p}" 2>/dev/null || true; } | while read -r pid; do
      kill "$pid" 2>/dev/null || true
    done
  done
  return 0
}
trap cleanup EXIT INT TERM HUP PIPE

for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "$BASE/offers?household=probe" 2>/dev/null; then break; fi
  sleep 0.1
done

for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "$SECOND/offers?household=probe" 2>/dev/null; then break; fi
  sleep 0.1
done

SEED_OUT="$(BASE="$BASE" bun scripts/seed.ts)"
EDGE="$(printf '%s\n' "$SEED_OUT" | sed -n 1p)"
MANDATE_KEY="$(printf '%s\n' "$SEED_OUT" | sed -n 2p)"
SEED_KEYS="$(printf '%s\n' "$SEED_OUT" | sed -n 3p)"
UNATTESTED_EDGE="$(printf '%s\n' "$SEED_OUT" | sed -n 4p)"
MANDATE_STATE="$(printf '%s\n' "$SEED_OUT" | sed -n 5p)"
# The receiving host needs the same catalogue, or an imported offer names a
# config version it has never seen.
# The same keys on the second host, or nothing that moved there would verify.
SEED_KEYS="$SEED_KEYS" BASE="$SECOND" bun scripts/seed.ts > /dev/null
# §13.1. The role-split pair is seeded as one implementation across two
# parties: the presenter's writes go to the engine, the person's to the hub.
# Without this the roles suite can only ask who answers, never whether the
# answer has anything behind it.
SEED_KEYS="$SEED_KEYS" BASE="$ENGINE_ONLY" HUB_BASE="$HUB_ONLY" bun scripts/seed.ts > /dev/null \
  || echo "the role-split pair could not be seeded; roles/ will say so" >&2

cd "$TESTS"
VALENCE_BASE_URL="$BASE" \
VALENCE_CONFIG_VERSION="cfg-conformance" \
VALENCE_HOUSEHOLD="household-conformance" \
VALENCE_MANDATE="mandate-conformance" \
VALENCE_MANDATE_KEY="$MANDATE_KEY" \
VALENCE_PRODUCTS="tea-a,tea-b,coffee-a,miso-a,nori-a" \
VALENCE_EXPLORATION_RATE="${VALENCE_EXPLORATION_RATE:-0.2}" \
VALENCE_LINEAGE_EDGE="$EDGE" \
VALENCE_UNATTESTED_EDGE="$UNATTESTED_EDGE" \
VALENCE_MANDATE_STATE="$MANDATE_STATE" \
VALENCE_PRICES='{"tea-a":1200,"tea-b":900,"coffee-a":1500,"miso-a":700,"nori-a":1100}' \
VALENCE_MAKERS='{"tea-a":"made-by-tea","tea-b":"made-by-tea","coffee-a":"made-by-coffee","miso-a":"made-by-miso","nori-a":"made-by-nori"}' \
VALENCE_BINDINGS="digital,physical" \
VALENCE_RECOVERY_GRACE_DAYS="0" \
VALENCE_RP_ID="conformance.example" \
VALENCE_SECOND_HOST_URL="$SECOND" \
VALENCE_ENGINE_ONLY_URL="$ENGINE_ONLY" \
VALENCE_HUB_ONLY_URL="$HUB_ONLY" \
VALENCE_CONFIG_VERSION_LATER="cfg-conformance-v2" \
VALENCE_CONFIG_VERSION_NARROW="cfg-conformance-narrow" \
VALENCE_CONFIG_VERSION_UNROOTED="cfg-other-merchant" \
VALENCE_PRODUCTS_UNROOTED="salt-a,salt-b" \
VALENCE_PRICES_LATER='{"tea-a":9900,"tea-b":900,"coffee-a":1500,"miso-a":700,"nori-a":1100}' \
  bun test ${SUITES:-absence floor silence lineage opacity binding machine exit approval permissions registry roles merchant-exit}
