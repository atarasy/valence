#!/usr/bin/env python3
"""Which mutation scripts no longer apply to the source they were written for?

A mutation whose anchor has drifted changes nothing, reports nothing, and reads
exactly like a mutation the corpus catches. `mutate.sh` calls that INERT and
`coverage.sh` reports it, but only after a full sweep, which is hours. This
does the same check in seconds by applying every script to a copy of `src` and
seeing which ones raise.

    python3 scripts/anchors.py

Run it after any change to `src`, and before trusting a coverage figure. It has
found three drifted anchors so far, each of them caused by a field added
between two lines some script had named as one:

  2026-09-09  112 scripts repointed when the reference split into directories
  2026-09-10  two scripts whose anchors moved with the day's new fields
  2026-09-11  hide_merchant_on_candidate, when §16.4's category was inserted
              between `ships` and `predicted_conversion` in the candidate view

Nothing here applies a mutation to the real source: the copy is thrown away.
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    scripts = sorted((HERE / "scripts/mutations").glob("*.py"))
    if not scripts:
        print("no mutation scripts found")
        return 1
    drifted: list[tuple[str, str]] = []
    with tempfile.TemporaryDirectory() as tmp:
        work = pathlib.Path(tmp)
        for script in scripts:
            target = work / "src"
            if target.exists():
                shutil.rmtree(target)
            # Every script must apply to untouched source, which is how the
            # sweep runs them: one at a time, from a clean tree.
            shutil.copytree(HERE / "src", target)
            result = subprocess.run(
                [sys.executable, str(script)], cwd=work, capture_output=True, text=True
            )
            if result.returncode != 0:
                last = (result.stderr.strip().split("\n") or [""])[-1]
                drifted.append((script.stem, last[:100]))
    print(f"mutation scripts: {len(scripts)}")
    print(f"anchors that no longer apply: {len(drifted)}")
    for name, err in drifted:
        print(f"  {name}: {err}")
    # A drifted anchor is a finding, not an error in this script, so the exit
    # status says whether anything needs a person rather than whether the run
    # worked.
    return 1 if drifted else 0


if __name__ == "__main__":
    raise SystemExit(main())
