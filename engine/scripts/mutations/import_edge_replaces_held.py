import pathlib
# §14.2, question 52. Write an imported edge under the id the body gives it
# whatever the host holds there, so an import under one household erases
# another household's edge.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    const held = at(edge.id);\n    if (!held) return edge.id;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    return edge.id;\n', 1)
p.write_text(s)
