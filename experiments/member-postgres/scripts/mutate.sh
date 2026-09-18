#!/usr/bin/env bash
# Apply one break to this package and report an explicit verdict.
#
# The engine has had a mutation corpus since 2026-09-09 and this package has
# had none, which is how seven refutation rounds each found a defect under the
# previous round's fix: every rule they closed arrived with no negative beside
# it. An infrastructure failure is not a test catching a break, so each verdict
# is decided from the run's own counts rather than from an exit code alone.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
SCOPE=(. ../member-read ../member-login ../member-transactions ../../engine/src)
if [ -n "$(git ls-files --others --exclude-standard -- "${SCOPE[@]}")" ] ||
   ! git diff --quiet -- "${SCOPE[@]}" || ! git diff --cached --quiet -- "${SCOPE[@]}"; then
  echo "ERROR: the sources must be tracked and clean before a mutation" >&2
  exit 3
fi
: "${ATARASY_TEST_POSTGRES_URL:?an isolated PostgreSQL URL is required}"
NAME="$1"; shift
LOGS="${MEMBER_LOG_DIR:-/tmp}"
mkdir -p "$LOGS"
# Installed only after proving there were no uncommitted edits to own.
restore() { git checkout -- "${SCOPE[@]}"; }
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
python3 "scripts/mutations/${NAME}.py" > "$LOGS/member-${NAME}-apply.log" 2>&1
if [ $? -ne 0 ]; then
  echo "ERROR: $NAME failed to apply completely" >&2
  exit 3
fi
if git diff --quiet -- "${SCOPE[@]}"; then
  echo "VERDICT: INERT"
  exit 2
fi
# Every package in scope, because a rule this package relies on may be proven
# in the package that owns it: `gate_restates_the_mandate_form` survived while
# only this package's tests ran, and `member-read` catches it.
: > "$LOGS/member-${NAME}.log"
for pkg in . ../member-read ../member-login ../member-transactions; do
  ( cd "$pkg" && bun test --timeout 60000 ) >> "$LOGS/member-${NAME}.log" 2>&1
done
PASSES=$(sed -nE 's/^ *([0-9]+) pass *$/\1/p' "$LOGS/member-${NAME}.log" | paste -sd+ - | bc)
FAILS=$(sed -nE 's/^ *([0-9]+) fail *$/\1/p' "$LOGS/member-${NAME}.log" | paste -sd+ - | bc)
NAMED=$(grep -Ec '^\(fail\)' "$LOGS/member-${NAME}.log" || true)
# A run that named no test at all never reached the assertions, so it says
# nothing about the break: that is an abort, not a catch.
if [ -z "$PASSES" ] || [ -z "$FAILS" ] || [ $((PASSES + FAILS)) -eq 0 ]; then
  echo "VERDICT: ABORTED"
  exit 4
fi
if [ "$FAILS" -gt 0 ] && [ "$NAMED" -gt 0 ]; then
  echo "VERDICT: CAUGHT ($FAILS of $((PASSES + FAILS)))"
  exit 0
fi
echo "VERDICT: SURVIVED"
exit 1
