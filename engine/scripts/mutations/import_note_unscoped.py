import pathlib
# §14.2, question 52. Accept a note on a candidate the import does not carry, so notes can be appended to another household's candidates.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = 'if (!carriedCandidates.has(n.candidate)) throw'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, 'if (false) throw', 1)
p.write_text(s)
