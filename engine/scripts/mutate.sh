#!/usr/bin/env bash
# Apply one mutation to the reference implementation, run the conformance
# suites, and restore. A test that stays green under its mutation is not a
# test, and this is how that is found out rather than assumed.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
# Restoring with `git checkout -- src` discards whatever is in the working
# tree, mutation or not. On 2026-09-08 that silently reverted a correction to
# ledger.ts that had been written minutes earlier and not yet committed, and
# nothing said so: the suite went green against the older text. Refuse to run
# unless src is clean, so the only thing a restore can throw away is the
# mutation this script applied.
# An untracked file under src is the same hazard by another route: the
# restore is `git checkout -- src`, which does not touch what git does not
# track, so a mutation applied to a new file survives the restore and every
# run afterwards is measuring the mutated engine. Measured 2026-09-08 on
# meter-ledger.ts before it was committed.
if [ -n "$(git ls-files --others --exclude-standard -- src)" ]; then
  echo "src has untracked files; commit them first." >&2
  echo "The restore is 'git checkout -- src', which would leave them mutated." >&2
  git ls-files --others --exclude-standard -- src >&2
  exit 1
fi

if ! git diff --quiet -- src || ! git diff --cached --quiet -- src; then
  echo "src has uncommitted changes; commit or stash them first." >&2
  echo "This script restores with 'git checkout -- src' and would discard them." >&2
  git status --short -- src >&2
  exit 1
fi

NAME="$1"; shift
echo "=== mutation: $NAME"
"$@"
# A mutation that changed nothing is not a mutation, and the suite that stays
# green under it is measuring an unmutated engine. This happened silently on
# 2026-09-09: `list_total` anchored on a line that had moved, its replace did
# nothing, and the run reported a clean pass for months of ledger entries.
# Sixty of the scripts assert their own anchors and the rest do not, so the
# check belongs here, where it covers every one of them.
if git diff --quiet -- src; then
  echo "INERT: $NAME changed nothing in src. Its anchor has drifted." >&2
  echo "The ledger row for it is unsupported until the script is repaired." >&2
  exit 2
fi
# Both suites, because they reach different code. The conformance probes talk
# HTTP and never see the ledger adapters; the engine's own tests do. A harness
# that ran only the first reported "0 fail" for a mutation that removed the
# reserve ceiling from the Meter adapter, which is the requirement the adapter
# exists to satisfy.
bun test > "/tmp/mutation-${NAME}-unit.log" 2>&1
UNIT=$?
./scripts/conformance.sh > "/tmp/mutation-${NAME}.log" 2>&1
STATUS=$?
echo -n "unit: "
grep -E '^ *[0-9]+ (pass|fail)' "/tmp/mutation-${NAME}-unit.log" | tr '\n' ' '
echo -n "  conformance: "
grep -E '^ *[0-9]+ (pass|fail)' "/tmp/mutation-${NAME}.log" | tr '\n' ' '
echo ""
grep -hE '^\(fail\)' "/tmp/mutation-${NAME}-unit.log" "/tmp/mutation-${NAME}.log" | head -12
if ! grep -q 'bun test v' "/tmp/mutation-${NAME}.log" 2>/dev/null; then
  # The run never reached a probe. A mutation that breaks the setup proves
  # nothing about the probes, and its log looks identical to a clean pass to
  # anything that greps for failures.
  echo "ABORTED: the suite never started. The mutation broke the setup, not a probe."
elif [ "$UNIT" -eq 0 ] && [ "$STATUS" -eq 0 ]; then
  echo "SURVIVED: no test failed under this mutation"
fi
git checkout -- src
echo "=== restored (suite exit ${STATUS})"
echo ""
