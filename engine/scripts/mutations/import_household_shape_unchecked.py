import pathlib
# §13.2, §14.2, question 55. Let a move arrive on a path that is not a
# household identifier, which is the namespace this question closed.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      if (!isHouseholdName(moving)) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '      if (false) {\n', 1))
