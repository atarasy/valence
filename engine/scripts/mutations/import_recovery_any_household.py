import pathlib
# §14.2, question 52. Accept a recovery record naming another household.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (r.household !== moving) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        if (false) {', 1)
p.write_text(s)
