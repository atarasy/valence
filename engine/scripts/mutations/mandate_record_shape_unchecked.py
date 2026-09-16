import pathlib
# §13.2, question 55. Record a mandate whose identifier is not its household's,
# so the key its versions are signed against is one anybody could register.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    if (householdOfMandate(mandate.id) !== mandate.household) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    if (false) {\n', 1))
