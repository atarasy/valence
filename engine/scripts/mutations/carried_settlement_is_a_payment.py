import pathlib
# §12, §14, question 61. List every settlement of a gift as its giver's
# payment, including one a recipient's import carried here.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      .filter((o) => o.giver === household && this.settledHere.has(o.id))\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      .filter((o) => o.giver === household)\n', 1)
p.write_text(s)
