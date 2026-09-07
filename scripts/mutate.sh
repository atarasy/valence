#!/usr/bin/env bash
# Apply one mutation to the reference implementation, run the conformance
# suites, and restore. A test that stays green under its mutation is not a
# test, and this is how that is found out rather than assumed.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
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
