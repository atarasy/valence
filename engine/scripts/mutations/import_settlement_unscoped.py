import pathlib
# §14.2, question 52. Accept a settlement for an offer the import does not carry, so another household's settlement can be overwritten.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = 'if (!carried.has(s_.offer)) throw'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, 'if (false) throw', 1)
p.write_text(s)
