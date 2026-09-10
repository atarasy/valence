#!/usr/bin/env python3
"""How fragile is each probe's proof?

`coverage.sh` answers whether a probe has ever been shown to fail. It does not
answer how much that rests on. A probe caught by one mutation loses its proof
the moment that script's anchor drifts, which happened to `accepts_unit_price`
on 2026-09-09 and went unnoticed because the harness could not report it.

Two weaknesses are reported here, both read from the logs `coverage.sh` leaves
in /tmp. Run it after a full measurement.

  python3 scripts/fragility.py [run-start 'YYYY-MM-DD HH:MM']

A mutation whose failures span many suites is flagged rather than judged: bun
prints a probe's name whether it failed in its setup or in its assertion, so
the difference between catching the corpus and breaking the shared fixture is
not in this data. Someone has to look.
"""
import os, sys, glob, re, datetime, collections

SPREAD_SUSPECT = 9  # suites; the excluded reject_foreign_offer_client spans 12

def main() -> int:
    start = 0.0
    if len(sys.argv) > 1:
        start = datetime.datetime.strptime(sys.argv[1], "%Y-%m-%d %H:%M").timestamp()
    by_probe: dict[str, set[str]] = collections.defaultdict(set)
    wide: set[str] = set()
    seen = 0
    for f in sorted(glob.glob("scripts/mutations/*.py")):
        m = os.path.basename(f)[:-3]
        log = f"/tmp/mutation-{m}.log"
        if not os.path.exists(log) or os.path.getmtime(log) < start:
            continue
        seen += 1
        fails = [
            re.sub(r" \[[0-9.]+m?s\]$", "", re.sub(r"^\(fail\) ", "", l))
            for l in open(log, errors="replace").read().splitlines()
            if l.startswith("(fail)")
        ]
        if len({x.split(":")[0] for x in fails}) >= SPREAD_SUSPECT:
            wide.add(m)
        for x in fails:
            by_probe[x].add(m)

    if not seen:
        print("no logs from that run. Pass the run's start time, or run coverage.sh first.")
        return 1

    counts = collections.Counter(len(v) for v in by_probe.values())
    single = sorted(p for p, ms in by_probe.items() if len(ms) == 1)
    only_wide = sorted(p for p, ms in by_probe.items() if ms and ms <= wide)

    print(f"mutations read        : {seen}")
    print(f"probes with a catch   : {len(by_probe)}")
    print(f"  caught by one       : {counts[1]}")
    print(f"  caught by two       : {counts[2]}")
    print(f"  caught by three plus: {sum(v for k, v in counts.items() if k >= 3)}")
    print(f"\nmutations spanning {SPREAD_SUSPECT}+ suites, which is the shape of one that")
    print(f"breaks the shared fixture rather than one the corpus catches:")
    for m in sorted(wide):
        print(f"  {m}")
    print(f"\nprobes whose only catch is one of those: {len(only_wide)}")
    for p in only_wide:
        print(f"  {p}")
    print(f"\nprobes resting on a single mutation: {len(single)}")
    for p in single:
        print(f"  {p} <- {next(iter(by_probe[p]))}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
