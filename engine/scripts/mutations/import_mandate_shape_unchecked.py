import pathlib
# §13.2, §14.2, question 55. Let a move carry a mandate whose identifier is not
# the path household's, which is the takeover question 52 closed by its field.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (householdOfMandate(m.id) !== moving) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '        if (false) {\n', 1))
