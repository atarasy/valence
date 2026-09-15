import pathlib
# §14.2, question 52. Write an imported edge under the id the body gives it
# whatever the host holds there, so an import under one household erases
# another household's edge.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      if (held && sameEdge(held, edge)) return null;\n      if (!held) return derived(n);\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '      return edge.id;\n', 1))
