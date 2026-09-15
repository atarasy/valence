import pathlib
# §7.1, question 52. Tell an edge from another by its signed bytes alone, so two
# separate gifts of one product that sign the same bytes become one edge and a
# gift is lost on the move.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      const held = at(derived(n));\n'
assert s.count(old) == 1, "anchor drifted"
new = '      for (const anywhere of this.edges.values()) if (sameEdge(anywhere, edge)) return null;\n' + old
p.write_text(s.replace(old, new, 1))
