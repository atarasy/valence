import pathlib
# §6.5, question 46, R1. A box whose only collection line is missing holds the
# presenter's next box, though nothing is owed on it. Re-anchored 2026-09-14
# when the founder's decision split the hold into two conditions.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "        if (recovery.consumed.length > 0) return true;"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "        if (recovery.consumed.length > 0 || recovery.missing.length > 0) return true;", 1)
p.write_text(s)
