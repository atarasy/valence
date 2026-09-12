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
import re
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent.parent


ASSIGNED = re.compile(r'^(\w+)\s*=\s*("""(?:.|\n)*?"""|"(?:[^"\\]|\\.)*")', re.M)
REPLACE = re.compile(r'\.replace\(\s*("""(?:.|\n)*?"""|"(?:[^"\\]|\\.)*"|\w+)\s*,')
TARGET = re.compile(r'pathlib\.Path\("([^"]+)"\)')


def static_drift(scripts: list[pathlib.Path]) -> list[tuple[str, str]]:
    """Every anchor a script replaces on, checked against the file it names.

    Read rather than run, so a script with no `assert` is covered too. It is
    deliberately conservative: a script whose target or anchor it cannot parse
    is skipped rather than reported, because a false name here would be read as
    a defect in the corpus.
    """
    out: list[tuple[str, str]] = []
    for script in scripts:
        text = script.read_text()
        targets = TARGET.findall(text)
        if len(targets) != 1:
            continue
        source = HERE / targets[0]
        if not source.exists():
            continue
        body = source.read_text()
        names = {k: eval(v) for k, v in ASSIGNED.findall(text)}
        for raw in REPLACE.findall(text):
            anchor = names.get(raw) if raw.isidentifier() else eval(raw)
            if anchor is None or not isinstance(anchor, str) or not anchor.strip():
                continue
            if anchor not in body:
                out.append((script.stem, anchor.strip().split("\n")[0][:70]))
    return out


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
    # **A script that asserts nothing cannot raise, so running it proves
    # nothing about its anchors.** `settle_at_latest_config` reported SURVIVED
    # in the sweep of 291 and was not a survivor: one of its two replacements
    # had drifted under the kept-gift fix, the other still changed text, so
    # `mutate.sh`'s inert check passed and the run read as a rule no probe
    # covers. **A partly applied mutation is worse than an inert one**, because
    # inert is reported and this is not. So every anchor is also read
    # statically, whether or not the script asserts it.
    silent = static_drift(scripts)
    print(f"mutation scripts: {len(scripts)}")
    print(f"anchors that no longer apply: {len(drifted)}")
    for name, err in drifted:
        print(f"  {name}: {err}")
    print(f"anchors that are absent from the source but raise nothing: {len(silent)}")
    for name, anchor in silent:
        print(f"  {name}: {anchor}")
    if silent:
        drifted = drifted + silent
    # A drifted anchor is a finding, not an error in this script, so the exit
    # status says whether anything needs a person rather than whether the run
    # worked.
    return 1 if drifted else 0


if __name__ == "__main__":
    raise SystemExit(main())
