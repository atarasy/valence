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
SURVIVED=""
ABORTED=""
COUNT=0
for f in scripts/mutations/*.py; do
  m=$(basename "$f" .py)
  RUN="$(./scripts/mutate.sh "$m" python3 "$f" 2>&1)"
  status=$?
  if [ "$status" = 2 ]; then INERT="$INERT $m"; continue; fi
  COUNT=$((COUNT + 1))
  # A mutation nothing caught, and one that broke the setup before any probe
  # ran, both contribute no failing probe to the union above, and before
  # 2026-09-09 both were indistinguishable from a mutation the probes caught.
  # conformance.sh exited 1 on every run, so mutate.sh's SURVIVED branch could
  # not fire, and the union is silent about a mutation that adds nothing to it.
  case "$RUN" in
    *"SURVIVED:"*) SURVIVED="$SURVIVED $m" ;;
    *"ABORTED:"*)  ABORTED="$ABORTED $m" ;;
  esac
  case " $EXCLUDE " in *" $m "*) continue ;; esac
  grep -hE '^\(fail\)' "/tmp/mutation-${m}.log" "/tmp/mutation-${m}-unit.log" 2>/dev/null \
    | sed -E 's/^\(fail\) //; s/ \[[0-9.]+m?s\]$//' >> "$OUT"
done
sort -u -o "$OUT" "$OUT"
echo "mutations run: $COUNT"
echo "probes shown to fail: $(wc -l < "$OUT")"
echo "mutations excluded from the count (they break the shared fixture):$( for m in $EXCLUDE; do printf ' %s' "$m"; done)"
if [ -n "$INERT" ]; then
  echo "INERT mutations, anchors drifted, ledger rows unsupported:$INERT"
fi
if [ -n "$SURVIVED" ]; then
  echo "SURVIVED, caught by no probe, ledger rows unsupported:$SURVIVED"
fi
if [ -n "$ABORTED" ]; then
  echo "ABORTED, broke the setup before any probe ran:$ABORTED"
fi
# The two names in EXCLUDE are a hand-maintained list, and nothing keeps it
# current. A mutation that breaks the shared fixture fails probes in their
# setup across every suite, which reads exactly like a mutation the whole
# corpus catches, and the difference does not appear in this output: bun
# prints a probe's name whether it failed in its setup or in its assertion.
# So the spread is reported and judged by a person. Measured 2026-09-10:
# reject_foreign_offer_client spans twelve suites and is excluded;
# decide_writes_on_refusal spans nine and is not.
echo ""
echo "mutations whose failures span four or more suites (check whether they break the fixture):"
for f in scripts/mutations/*.py; do
  m=$(basename "$f" .py)
  [ -f "/tmp/mutation-${m}.log" ] || continue
  spread=$(grep -hE '^\(fail\)' "/tmp/mutation-${m}.log" 2>/dev/null \
    | sed -E 's/^\(fail\) //; s/:.*//' | sort -u | wc -l | tr -d ' ')
  [ "${spread:-0}" -ge 4 ] && printf '  %-36s %s suites\n' "$m" "$spread"
done
