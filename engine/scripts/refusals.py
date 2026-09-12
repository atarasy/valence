#!/usr/bin/env python3
"""Which refusals the specification names, which the engine emits, and which a
probe asserts.

Lands as `valence/engine/scripts/refusals.py`, beside `anchors.py`, and is run
the same way: in seconds, before any coverage figure is quoted.

**Why it exists.** §16.6's whole subject is that a person must be able to tell
one `422` from another, and on 2026-09-13 it was the least covered section in
the specification. Of the four names it lists, `mandate_ceiling_out_of_network`
appeared in neither the engine nor the suites, the engine emitting
`over_ceiling` instead; `mandate_lapsed` was emitted and asserted by nothing;
and `permissions/permissions.test.ts` asserted `over_ceiling`, so a conformance
probe was pinning the engine's departure from the section it sits nearest to.

**The mutation corpus cannot find this.** A mutation that stops a refusal
happening is caught by the probe that expects it. A refusal that answers to the
wrong word is caught by nothing, because no probe and no sweep compares the set
of names an engine emits against the set the specification lists. That is what
this does.

    cd engine && python3 scripts/refusals.py

It judges nothing. It prints three columns for a person to read, the way
`anchors.py` prints a list of scripts rather than a verdict.
"""
import os
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent
SPEC = HERE.parent / "SPEC.md"
SUITES = pathlib.Path(
    os.environ.get("ATARAXIA_TESTS", pathlib.Path.home() / "Documents/GitHub/ataraxia/tests")
)

if not SPEC.exists():
    sys.exit(f"no specification at {SPEC}")

spec = SPEC.read_text()

# §16.6 carries the list in a fenced block, one name per position, separated by
# pipes and newlines. Anything that looks like a refusal name is taken.
section = re.search(r"### 16\.6.*?```(.*?)```", spec, re.S)
if not section:
    sys.exit("§16.6's fenced list of names was not found; the section moved")
named = sorted(set(re.findall(r"[a-z][a-z_]{3,}", section.group(1))))

# What the engine actually throws, from the first argument of each refusal.
emitted = set()
for path in (HERE / "src").rglob("*.ts"):
    text = path.read_text()
    for m in re.finditer(r'(?:unprocessable|conflict|badRequest|notFound)\(\s*"([a-z_]+)"', text):
        emitted.add(m.group(1))

# What a probe asserts. A name in a suite is a name something checks.
asserted = set()
if SUITES.exists():
    for path in SUITES.rglob("*.test.ts"):
        asserted.update(re.findall(r'"([a-z][a-z_]{3,})"', path.read_text()))
else:
    print(f"note: no suites at {SUITES}; the third column is unmeasured\n")

print(f"§16.6 names {len(named)} refusals of a protection\n")
print(f"{'name':<34} {'engine':<8} {'a probe':<8}")
for name in named:
    print(f"{name:<34} {'yes' if name in emitted else 'NO':<8} {'yes' if name in asserted else 'NO':<8}")

# The other direction: a refusal the engine throws under a name no section lists
# is one a person cannot look up, which is what §16.6 exists against.
# The first version of this check asked only for names beginning "mandate_",
# and the name that had gone wrong was `over_ceiling`. A refusal the engine
# throws under a name **the specification does not use anywhere** is one a
# person cannot look up and a reader cannot check against anything.
# **Narrowed on purpose.** Every refusal the specification does not name is
# eighteen rows, most of them internal errors no section has occasion to
# mention, and a check nobody finishes reading is a check nobody runs. The
# sharp case is a name **a probe pins** that the specification does not define:
# there the suite is certifying a word the specification never chose, which is
# how `over_ceiling` survived beside §16.6's own list of four.
stray = sorted(n for n in emitted if n not in spec and n in asserted)
unnamed = sum(1 for n in emitted if n not in spec)
if stray:
    print("\nasserted by a probe and named nowhere in the specification:")
    for n in stray:
        print(f"  {n}")
print(f"\n{len(emitted)} refusal names in the engine, {unnamed} of them in no section.")

print("\nThis judges nothing. A name missing from the engine may be one the")
print("engine has no occasion to throw; a name missing from a probe is a")
print("refusal nothing checks the wording of. Read the rows.")
