import pathlib
# §14.2, question 52. Accept a delivery for an offer the import does not carry, so a carriage can be planted and then fixed for an offer not yet held.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = 'if (!carried.has(d.offer)) throw'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, 'if (false) throw', 1)
p.write_text(s)
