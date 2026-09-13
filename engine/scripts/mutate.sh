#!/usr/bin/env bash
# Apply one break and report an explicit verdict. An infrastructure failure
# is not a test catching the break. The source must be clean before we own it.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
if [ -n "$(git ls-files --others --exclude-standard -- src)" ] ||
   ! git diff --quiet -- src || ! git diff --cached --quiet -- src; then
  echo "ERROR: src must be tracked and clean before a mutation" >&2
  exit 3
fi
NAME="$1"; shift
LOGS="${VALENCE_LOG_DIR:-/tmp}"
mkdir -p "$LOGS"
EXITS="$LOGS/mutation-${NAME}.exits"
: > "$EXITS"
# This trap is installed only after proving there were no user source edits.
restore() { git checkout -- src; }
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
"$@" > "$LOGS/mutation-${NAME}-apply.log" 2>&1
APPLIED=$?
echo "mutation $APPLIED" >> "$EXITS"
if [ "$APPLIED" -ne 0 ]; then
  echo "ERROR: $NAME failed to apply completely" >&2
  exit 3
fi
if git diff --quiet -- src; then
  echo "VERDICT: INERT"
  exit 2
fi
bun test > "$LOGS/mutation-${NAME}-unit.log" 2>&1
UNIT=$?
echo "unit $UNIT" >> "$EXITS"
./scripts/conformance.sh > "$LOGS/mutation-${NAME}.log" 2>&1
CONF=$?
echo "conformance $CONF" >> "$EXITS"
# Validate each population independently. A failure in one cannot hide an
# infrastructure error in the other, and a fully skipped run proves nothing.
validate_log() {
  local log="$1" status="$2" passes fails lines
  passes=$(sed -nE 's/^ *([0-9]+) pass *$/\1/p' "$log" | tail -n 1)
  fails=$(sed -nE 's/^ *([0-9]+) fail *$/\1/p' "$log" | tail -n 1)
  lines=$(grep -Ec '^\(fail\)' "$log" || true)
  if ! grep -Eq 'Ran [0-9]+ tests? across [0-9]+ files?' "$log" ||
     [ -z "$passes" ] || [ -z "$fails" ] ||
     [ "$(( ${passes:-0} + ${fails:-0} ))" -eq 0 ]; then
    echo "ERROR: $NAME has an incomplete or unexercised test log: $log" >&2
    return 1
  fi
  if [ "$status" -eq 0 ] && [ "$fails" -eq 0 ] && [ "$lines" -eq 0 ]; then return 0; fi
  if [ "$status" -eq 1 ] && [ "$fails" -gt 0 ] && [ "$lines" -gt 0 ]; then return 0; fi
  echo "ERROR: $NAME has inconsistent exits and failures: $log" >&2
  return 1
}
validate_log "$LOGS/mutation-${NAME}-unit.log" "$UNIT" || exit 3
# A seed failure is recorded separately, never as a failed conformance probe.
if ! grep -q 'bun test v' "$LOGS/mutation-${NAME}.log"; then
  if [ "$CONF" -eq 0 ]; then
    echo "ERROR: conformance returned success without starting tests" >&2
    exit 3
  fi
  echo "VERDICT: ABORTED"
  exit 0
fi
validate_log "$LOGS/mutation-${NAME}.log" "$CONF" || exit 3
if [ "$UNIT" -eq 0 ] && [ "$CONF" -eq 0 ]; then
  echo "VERDICT: SURVIVED"
else
  echo "VERDICT: CAUGHT"
fi
