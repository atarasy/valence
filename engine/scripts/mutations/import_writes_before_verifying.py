import pathlib
# §14.2, question 51. Drop the verification of the whole body, so the import
# writes row by row again and a move refused at an edge keeps its offers,
# loses its collections and mandates, and cannot be retried.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      engine.checkImport(body_.offers ?? [], moving, body_.lineage ?? []);\n      deliveries.checkRows(body_.deliveries ?? []);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
