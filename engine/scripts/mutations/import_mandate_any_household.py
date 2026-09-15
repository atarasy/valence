import pathlib
# §14.2, question 52. Accept a mandate naming another household, so an import under one household replaces another's mandate.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (m.household !== moving) {\n          throw unprocessable("wrong_household", `mandate'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        if (false) {\n          throw unprocessable("wrong_household", `mandate', 1)
p.write_text(s)
