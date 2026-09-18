import pathlib
# §14.2, question 57. Keep the delivery rows of an offer left behind, so a
# delivered box alone refuses the whole move again: the row names an offer the
# body no longer carries.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        body_.deliveries = (body_.deliveries ?? []).filter((r) => !behind.has(r.offer));\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
