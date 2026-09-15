import pathlib
# §14.2, question 51. Accept a row key holding a lone surrogate. It binds, and
# bun:sqlite reads it back as the empty string, so two such rows collapse into
# one on the next start.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = ' || !id.isWellFormed()'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
