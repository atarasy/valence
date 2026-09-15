import pathlib
# §14.2, question 51. Stop checking that each keyed row carries a string key,
# so on a persistent store the key fails to bind after the row is in memory
# and the import is left half written.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          if (typeof row[key] !== "string" || !row[key]) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '          if (false) {\n', 1)
p.write_text(s)
