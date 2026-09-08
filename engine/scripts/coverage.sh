#!/usr/bin/env bash
# Which probes actually fail under at least one mutation.
#
# The notes in the suites are a claim; this is the measurement. A probe that
# never appears here has not been shown to fail, whatever its comment says, and
# by the rule in tests/README.md it is not counted.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
OUT="${1:-/tmp/valence-coverage.txt}"
# Two mutations break offer creation for the whole suite: every probe that
# creates an offer then fails in its setup, whatever its own assertion says.
# Counting those as "shown to fail" would make the headline number mean
# something other than the rule in tests/README.md, so they are measured
# separately and named here. Found on 2026-09-09 by an adversarial pass.
EXCLUDE="require_registered_merchant reject_foreign_offer_client"
: > "$OUT"
INERT=""
for f in scripts/mutations/*.py; do
  m=$(basename "$f" .py)
  ./scripts/mutate.sh "$m" python3 "$f" > /dev/null 2>&1
  status=$?
  if [ "$status" = 2 ]; then INERT="$INERT $m"; continue; fi
  case " $EXCLUDE " in *" $m "*) continue ;; esac
  grep -hE '^\(fail\)' "/tmp/mutation-${m}.log" "/tmp/mutation-${m}-unit.log" 2>/dev/null \
    | sed -E 's/^\(fail\) //; s/ \[[0-9.]+m?s\]$//' >> "$OUT"
done
sort -u -o "$OUT" "$OUT"
echo "probes shown to fail: $(wc -l < "$OUT")"
echo "mutations excluded from the count (they break the shared fixture):$( for m in $EXCLUDE; do printf ' %s' "$m"; done)"
if [ -n "$INERT" ]; then
  echo "INERT mutations, anchors drifted, ledger rows unsupported:$INERT"
fi
