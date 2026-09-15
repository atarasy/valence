import pathlib
# §16.1, question 52. Take a mandate a move carries whatever it says, so a move
# loosens one the host holds without the co-signers a change needs.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (held && (loosens(held, m) || m.version < held.version)) taken.delete(m.id);\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
