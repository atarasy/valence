import pathlib
# §7.1, question 52. Store an imported edge's `attested` as the body says, so a
# key no root endorsed makes a product known to its recipient (§5.1).
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    this.edges.set(edge.id, { ...edge, attested: this.rootEndorsed.has(edge.from) });\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    this.edges.set(edge.id, edge);\n', 1)
p.write_text(s)
