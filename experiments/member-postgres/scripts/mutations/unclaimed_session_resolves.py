import pathlib
# §13.2, question 55. Resolve a session whose principal has no household, so
# a read is keyed on a household that is not one.
p = pathlib.Path('authority.ts'); s = p.read_text()
old = '      if (!row || row.household === null) return;'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      if (!row) return;', 1)
p.write_text(s)
