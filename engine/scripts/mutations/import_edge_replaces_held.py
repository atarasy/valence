import pathlib
# §14.2, question 52. Let an imported edge replace one the host holds, so an
# import under one household erases another household's edge by its id.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (held && !sameEdge(held, edge)) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false) {\n', 1)
old = '    if (this.edges.has(edge.id)) return;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
