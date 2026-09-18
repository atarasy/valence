import pathlib
# §13.2, question 55. Narrow the path filter back to characters an identifier
# does not have, so no household can read its own mandate.
p = pathlib.Path('http.ts'); s = p.read_text()
old = r'/^\/_node\/mandates\/[A-Za-z0-9_.:%-]+$/'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, r'/^\/_node\/mandates\/[A-Za-z0-9_-]+$/', 1)
p.write_text(s)
