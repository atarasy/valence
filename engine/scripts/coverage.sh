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
: > "$OUT"
for f in scripts/mutations/*.py; do
  m=$(basename "$f" .py)
  ./scripts/mutate.sh "$m" python3 "$f" > /dev/null 2>&1
  grep -hE '^\(fail\)' "/tmp/mutation-${m}.log" "/tmp/mutation-${m}-unit.log" 2>/dev/null \
    | sed -E 's/^\(fail\) //; s/ \[[0-9.]+m?s\]$//' >> "$OUT"
done
sort -u -o "$OUT" "$OUT"
echo "probes shown to fail: $(wc -l < "$OUT")"
