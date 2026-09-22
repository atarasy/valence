import pathlib
# §14.2, question 70. Take corrections for an offer the body does not carry.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          throw unprocessable("unscoped_correction", `a correction names ${id}, which this import does not carry`);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
