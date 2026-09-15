import pathlib
# §7.1, question 52. Tell one edge from another by its id alone, so a household
# whose edge was re-keyed once carries the re-keyed copy while its counterparty
# carries the original, and a host takes both: one squat forks that lineage.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      if (held && sameEdge(held, edge)) return null;\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
