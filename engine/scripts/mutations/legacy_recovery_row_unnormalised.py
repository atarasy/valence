import pathlib

# A recovery row stored before question 46 is read as stored, with no
# `missing` list. The offer views and `present`'s hold check both failed on
# such a row in the development store on 2026-09-15.

p = pathlib.Path("src/engine/physical.ts"); s = p.read_text()
a = "    if (!row || (row.missing !== undefined && row.missing_notes !== undefined)) return row;"
assert a in s, "physical.ts legacy_recovery_row_unnormalised anchor has drifted"
s = s.replace(a, "    return row;", 1)
p.write_text(s)
