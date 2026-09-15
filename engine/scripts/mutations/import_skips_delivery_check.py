import pathlib
# §14.2, question 51. Leave the delivery rows out of the check of the whole
# body, so a carriage that cannot be taken is refused only after the offers,
# collections and mandates before it are written.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      deliveries.checkRows(body_.deliveries ?? []);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
