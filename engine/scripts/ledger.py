"""Which mutations have no row in the ledger, and which rows have no mutation.

`ataraxia/tests/MUTATIONS.md` is what a reader consults to learn how much a
rule rests on, and it is maintained by hand. **A mutation added without its row
is invisible there**: the corpus catches it, the sweep counts it, and the one
document that says what it proves does not mention it. Two were found that way
on 2026-09-13, both added with a question's implementation the same week.

The reverse is a different thing and usually not a defect. A row whose script
is gone is correct where the rule itself was withdrawn, and the ledger says so
in the row. So a row is only named here when it does **not** carry the word
"Retired", and the two populations are printed apart rather than summed.

This judges nothing. A row may legitimately name something that is not a
mutation script at all: the ledger's other tables list suites.
"""

import os
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
# The sibling checkout, as `conformance.sh` assumes it. `ATARAXIA_HOME` moves it
# for a worktree, which is where this project measures a branch.
LEDGER = pathlib.Path(
    os.environ.get("ATARAXIA_HOME", HERE.parents[2] / "ataraxia")
) / "tests" / "MUTATIONS.md"

scripts = {p.stem for p in (HERE / "mutations").glob("*.py")}
if not LEDGER.exists():
    print(f"ledger not found at {LEDGER}", file=sys.stderr)
    raise SystemExit(2)

# The ledger's rows open with the mutation in backticks. **The cell may carry
# more than the name**: two rows read "`name` (re-anchored 2026-09-09)", and a
# pattern demanding the column end right after the backtick reported both as
# having no row at all, which is a checker inventing the defect it looks for.
# So match the backticked name at the head of the first cell and let the rest
# of that cell be anything. Keep the whole row, because whether it says
# "Retired" decides how a missing script reads.
#
# **One table here is not about mutations at all.** It lists probes with no
# mutation, and its first cell reads "`suite` > the probe's name", so a bare
# match on the backticked head takes the suite for a mutation and reports five
# that were never meant to be any. The ` > ` is what tells the two tables
# apart.
rows = {}
for line in LEDGER.read_text().splitlines():
    m = re.match(r"\|\s*`([a-z0-9_]+)`([^|]*)\|", line)
    if m and " > " not in m.group(2):
        rows[m.group(1)] = line

missing_row = sorted(scripts - rows.keys())
missing_script = sorted(
    name for name in rows.keys() - scripts if "Retired" not in rows[name]
)
retired = sorted(name for name in rows.keys() - scripts if "Retired" in rows[name])

print(f"mutation scripts: {len(scripts)}")
print(f"ledger rows: {len(rows)}  ({len(retired)} retired with the rule they broke)")
print(f"mutations with no row: {len(missing_row)}")
for name in missing_row:
    print(f"  {name}")
print(f"rows with no script and not marked retired: {len(missing_script)}")
for name in missing_script:
    print(f"  {name}")
