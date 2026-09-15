import pathlib
# §14.2, question 50. Stop reading valence-node/5 once the export moved to /6,
# so a node exported before the move to /6 cannot arrive anywhere.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = ' && body_.format !== "valence-node/5"'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
