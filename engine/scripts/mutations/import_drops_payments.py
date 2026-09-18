import pathlib
# §12, §14, question 61. The receiving host drops the payments a giver brought.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        engine.importPayments(moving, body_.payments ?? []);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
