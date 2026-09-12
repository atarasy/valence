#!/usr/bin/env bash
# Which probes actually fail under at least one mutation.
#
# The notes in the suites are a claim; this is the measurement. A probe that
# never appears here has not been shown to fail, whatever its comment says, and
# by the rule in tests/README.md it is not counted.
#
# The sweep takes hours, and on 2026-09-10 it was killed for memory at 155 of
# 173 with nothing kept. So each mutation's result is written to a directory
# keyed by the content of everything that decides the outcome, and a rerun
# reuses only what was measured against that exact content. A change to src, to
# a mutation script or to a suite gives a different key and measures again.
# `--fresh` discards the directory first.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
TESTS="${ATARAXIA_TESTS:-$HOME/Documents/GitHub/ataraxia/tests}"
FRESH=""
case "${1:-}" in --fresh) FRESH=1; shift ;; esac
OUT="${1:-}"
# Two mutations break offer creation for the whole suite: every probe that
# creates an offer then fails in its setup, whatever its own assertion says.
# Counting those as "shown to fail" would make the headline number mean
# something other than the rule in tests/README.md, so they are measured
# separately and named here. Found on 2026-09-09 by an adversarial pass.
EXCLUDE="require_registered_merchant reject_foreign_offer_client disclosure_not_carried"

# Includes the harness, engine unit tests, manifests and effective settings.
# Do not reuse the old incomplete key space.
KEY="$(python3 scripts/sweep-inputs.py)" || exit 1
# Results and per-mutation logs used to live under /tmp, and on 2026-09-11 a
# reboot cleared it: a finished sweep of 192 mutations lost every verdict and
# every log behind its figures, and the resume directory this script exists for
# went with them. The default is now a directory that survives a restart, and
# `VALENCE_SWEEP_HOME` moves it. The key still decides the subdirectory, so a
# run against different code still measures again rather than reusing anything.
HOME_DIR="${VALENCE_SWEEP_HOME:-$HOME/Documents/valence-sweeps}"
RESULTS="${HOME_DIR}/sweep-${KEY}"
# mutate.sh writes each mutation's logs, and fragility.py reads them. They are
# the evidence for every per-probe figure, so they belong beside the verdicts.
export VALENCE_LOG_DIR="${RESULTS}/logs"
[ -n "$FRESH" ] && rm -rf "$RESULTS"
mkdir -p "$RESULTS" "$VALENCE_LOG_DIR"
# The union of probes is written beside the verdicts unless a path was given.
OUT="${OUT:-$RESULTS/probes-shown-to-fail.txt}"
echo "results: $RESULTS"

if [ -f "$RESULTS/INVALID" ]; then
  echo "This result directory contains an invalidated run; archive it before restarting." >&2
  exit 1
fi
same_inputs() {
  local current
  current="$(python3 scripts/sweep-inputs.py)" || {
    echo "Input hashing failed" > "$RESULTS/INVALID"
    return 1
  }
  if [ "$KEY" != "$current" ]; then
    echo "Inputs changed during measurement; do not reuse these results." > "$RESULTS/INVALID"
    cat "$RESULTS/INVALID" >&2
    return 1
  fi
}

TOTAL=$(ls scripts/mutations/*.py | wc -l | tr -d ' ')
DONE=0
for f in scripts/mutations/*.py; do
  m=$(basename "$f" .py)
  DONE=$((DONE + 1))
  same_inputs || exit 1
  if [ -f "$RESULTS/$m.status" ]; then
    case "$(cat "$RESULTS/$m.status")" in
      CAUGHT|SURVIVED|ABORTED|INERT) ;;
      *) echo "Invalid cached verdict for $m" >&2; exit 1 ;;
    esac
    if [ ! -f "$RESULTS/$m.fails" ] || [ ! -f "$RESULTS/$m.suites" ]; then
      echo "Incomplete cached record for $m" >&2
      exit 1
    fi
    continue
  fi
  # A mutation left applied by a killed run would be measured as part of the
  # next one, and every mutation after it too. mutate.sh refuses on a dirty
  # src, but it refuses one at a time and the sweep would report the whole
  # remainder as caught by nothing. Stop instead, and say what to do.
  if ! git diff --quiet -- src; then
    echo "src is dirty at mutation ${DONE}/${TOTAL} (${m}); a previous mutation was left applied." >&2
    echo "Diff it against scripts/mutations/ to find which, restore with 'git checkout -- src', and rerun." >&2
    exit 1
  fi
  printf '[%3d/%d] %s\n' "$DONE" "$TOTAL" "$m"
  RUN="$(./scripts/mutate.sh "$m" python3 "$f" 2>&1)"
  RUN_STATUS=$?
  VERDICT="$(printf '%s\n' "$RUN" | sed -n 's/^VERDICT: //p')"
  case "$VERDICT:$RUN_STATUS" in
    CAUGHT:0|SURVIVED:0|ABORTED:0|INERT:2) ;;
    *)
      printf '%s\n' "$RUN" >&2
      echo "No trustworthy verdict for $m; sweep stopped without caching it." >&2
      exit 1 ;;
  esac
  grep -hE '^\(fail\)' "$VALENCE_LOG_DIR/mutation-${m}.log" "$VALENCE_LOG_DIR/mutation-${m}-unit.log" 2>/dev/null \
    | sed -E 's/^\(fail\) //; s/ \[[0-9.]+m?s\]$//' | sort -u > "$RESULTS/$m.fails"
  # The spread is a count of conformance suites, so it reads the conformance
  # log alone. A unit test's name yields a prefix of its own, and counting
  # those inflates the number against a threshold calibrated on suites.
  grep -hE '^\(fail\)' "$VALENCE_LOG_DIR/mutation-${m}.log" 2>/dev/null \
    | sed -E 's/^\(fail\) //; s/:.*//' | sort -u > "$RESULTS/$m.suites"
  same_inputs || exit 1
  # Publish the status last, so an interrupted write is not a cached result.
  printf '%s\n' "$VERDICT" > "$RESULTS/$m.status.tmp"
  mv "$RESULTS/$m.status.tmp" "$RESULTS/$m.status"
done

same_inputs || exit 1

: > "$OUT"
INERT=""; SURVIVED=""; ABORTED=""; COUNT=0
for f in scripts/mutations/*.py; do
  m=$(basename "$f" .py)
  case "$(cat "$RESULTS/$m.status")" in
    INERT)    INERT="$INERT $m"; continue ;;
    SURVIVED) SURVIVED="$SURVIVED $m" ;;
    ABORTED)  ABORTED="$ABORTED $m" ;;
  esac
  COUNT=$((COUNT + 1))
  case " $EXCLUDE " in *" $m "*) continue ;; esac
  cat "$RESULTS/$m.fails" >> "$OUT"
done
sort -u -o "$OUT" "$OUT"
echo "mutation scripts: $TOTAL"
echo "mutations run, excluding inert: $COUNT"
for verdict in CAUGHT SURVIVED INERT ABORTED; do
  n=$(grep -l "^${verdict}$" "$RESULTS"/*.status | wc -l | tr -d ' ')
  echo "$verdict: $n"
done
echo "distinct failed test names, conformance and unit combined: $(wc -l < "$OUT")"
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
# decide_writes_on_refusal spans nine and is not. **disclosure_not_carried was
# added on 2026-09-12**: every decided set names a merchant, so an offer with
# no disclosure refuses every decision in every suite, and 28 probes fail in
# their setup. The probe that proves §10a.4 is the one named in its ledger row,
# and it fails on its assertion; the other 27 prove nothing about it.
echo ""
echo "mutations whose failures span four or more suites (check whether they break the fixture):"
for f in scripts/mutations/*.py; do
  m=$(basename "$f" .py)
  [ -f "$RESULTS/$m.suites" ] || continue
  spread=$(wc -l < "$RESULTS/$m.suites" | tr -d ' ')
  if [ "${spread:-0}" -ge 4 ]; then printf '  %-36s %s suites\n' "$m" "$spread"; fi
done
# The loop's last test decides the script's status otherwise, so a run whose
# final mutation spans fewer than four suites exits 1 while reporting a clean
# measurement. That is the defect this script was corrected for on 2026-09-09,
# reintroduced on 2026-09-10 by the check added to report it.
exit 0
