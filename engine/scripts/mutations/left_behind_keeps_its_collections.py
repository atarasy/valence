import pathlib
# §14.2, question 57. Keep the collection of an offer left behind, so it
# names an offer the body no longer carries and the whole move is refused.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        body_.collections = (body_.collections ?? []).filter((r) => !behind.has(r.offer));\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
