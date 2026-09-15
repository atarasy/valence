import pathlib
# §16.1, question 52. Let an import replace a mandate the host holds with one
# that gives the household less, which needs the co-signers a move cannot carry.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (held && looser(m, held)) taken.delete(m.id);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        if (false) taken.delete(m.id);\n', 1)
p.write_text(s)
