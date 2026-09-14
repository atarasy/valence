import pathlib
# §11.2, question 46. A note keyed to an item not named missing is accepted and
# dropped in silence.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (stray.length > 0) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        if (false) {', 1)
p.write_text(s)
