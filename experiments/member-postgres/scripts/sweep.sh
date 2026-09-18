#!/usr/bin/env bash
# Run the whole corpus and print one line per mutation, then the counts.
# Each run restores the sources, so a killed sweep leaves nothing applied; it
# is the same discipline as the engine's, at a smaller scale.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
: "${ATARASY_TEST_POSTGRES_URL:?an isolated PostgreSQL URL is required}"
caught=0; survived=0; inert=0; aborted=0; failed=0
for script in scripts/mutations/*.py; do
  name="$(basename "$script" .py)"
  verdict="$(./scripts/mutate.sh "$name" 2>&1 | tail -1)"
  printf '%-44s %s\n' "$name" "$verdict"
  case "$verdict" in
    *CAUGHT*) caught=$((caught+1)) ;;
    *SURVIVED*) survived=$((survived+1)) ;;
    *INERT*) inert=$((inert+1)) ;;
    *ABORTED*) aborted=$((aborted+1)) ;;
    *) failed=$((failed+1)) ;;
  esac
done
echo
echo "caught $caught  survived $survived  inert $inert  aborted $aborted  failed to apply $failed"
[ "$survived" -eq 0 ] && [ "$inert" -eq 0 ] && [ "$aborted" -eq 0 ] && [ "$failed" -eq 0 ]
