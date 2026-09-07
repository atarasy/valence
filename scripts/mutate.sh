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
if ! git diff --quiet -- src || ! git diff --cached --quiet -- src; then
  echo "src has uncommitted changes; commit or stash them first." >&2
  echo "This script restores with 'git checkout -- src' and would discard them." >&2
  git status --short -- src >&2
  exit 1
fi

NAME="$1"; shift
echo "=== mutation: $NAME"
"$@"
./scripts/conformance.sh > "/tmp/mutation-${NAME}.log" 2>&1
STATUS=$?
grep -E '^ *[0-9]+ (pass|fail)' "/tmp/mutation-${NAME}.log" | tr '\n' ' '
echo ""
grep -E '^\(fail\)' "/tmp/mutation-${NAME}.log" | head -12
git checkout -- src
echo "=== restored (suite exit ${STATUS})"
echo ""
