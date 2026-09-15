import pathlib
# §16.1, question 52. Let a mandate that gives the household less replace the
# one the host holds, which needs the co-signers a move cannot carry.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = 'loosens(held, m) || '
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
