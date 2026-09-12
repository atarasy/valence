#!/usr/bin/env python3
"""Textual occurrences of refusal names, for a manual contract review.

Lands as `valence/engine/scripts/refusals.py`, beside `anchors.py`, and is run
the same way: in seconds, before any coverage figure is quoted.

**Why it exists.** §16.6's whole subject is that a person must be able to tell
one `422` from another, and on 2026-09-13 it was the least covered section in
the specification. Of the four names it lists, `mandate_ceiling_out_of_network`
appeared in neither the engine nor the suites, the engine emitting
`over_ceiling` instead; `mandate_lapsed` was emitted and asserted by nothing;
and `permissions/permissions.test.ts` asserted `over_ceiling`, so a conformance
probe was pinning the engine's departure from the section it sits nearest to.

**This is a presence scan, not a proof of definition or assertion.** A name
can occur in ordinary specification prose, a test comment or a request value.
The scan also omits codes constructed outside the helper calls below. A probe
that asserts the response error can catch a mutation that renames it; a
status-only probe cannot. Read the actual trigger and assertion before
interpreting these columns as coverage.

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
    # **The name may not sit on the same line as the call.** A comment between
    # the two is ordinary, and the first version of this read only the same
    # line: it reported `mandate_ceiling_out_of_network` as absent from the
    # engine on the very afternoon it was put there, under a comment saying
    # why. A detector too narrow is as useless as one too broad.
    for m in re.finditer(
        r'(?:unprocessable|conflict|badRequest|notFound)\((?:\s|//[^\n]*\n)*"([a-z_]+)"', text
    ):
        emitted.add(m.group(1))

# Quoted-string occurrences in suite files, including comments and inputs.
# They are candidates for review, not evidence of response assertions.
asserted = set()
if SUITES.exists():
    for path in SUITES.rglob("*.test.ts"):
        asserted.update(re.findall(r'"([a-z][a-z_]{3,})"', path.read_text()))
else:
    print(f"note: no suites at {SUITES}; the third column is unmeasured\n")

print(f"§16.6 names {len(named)} refusals of a protection\n")
print(f"{'name':<34} {'engine':<8} {'suite text':<10}")
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
    print("\nquoted in suite text and absent from specification text:")
    for n in stray:
        print(f"  {n}")
# **And the other direction, which the first version could not show.** A name
# the specification uses and no probe asserts is a refusal nothing checks the
# wording of, and rewriting one probe can take the last assertion of a name
# away without anything saying so. That happened on 2026-09-13 to
# `cooling_over`, when the probe that asserted it was rewritten for question 43.
unasserted = sorted(n for n in emitted if n in spec and n not in asserted)
if unasserted:
    print("\noccurs in specification text, with no quoted suite occurrence:")
    for n in unasserted:
        print(f"  {n}")

print(f"\n{len(emitted)} literal helper-call names scanned, {unnamed} absent from specification text.")

print("\nThis judges nothing. A name missing from the engine may be one the")
print("engine has no occasion to throw. A suite occurrence may be a comment")
print("or request input, and a specification substring may be ordinary prose.")
print("Read the response assertions and normative definitions before claiming coverage.")
