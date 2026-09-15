import pathlib
# §13.2, question 53. Open no transaction, so every row an atomic block writes
# commits as it is written and a process that stops partway leaves them on disk.
p = pathlib.Path('src/common/store.ts'); s = p.read_text()
old = '    for (const db of dbs) db.run("BEGIN IMMEDIATE");\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
old = '    for (const db of dbs) db.run("COMMIT");\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
