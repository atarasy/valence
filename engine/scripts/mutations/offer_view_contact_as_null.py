import pathlib
# Question 72. The same on `GET /offers/{id}`.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      ...(d.contact ? { contact: d.contact } : {}),\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      contact: d.contact ?? null,\n', 1)
p.write_text(s)
