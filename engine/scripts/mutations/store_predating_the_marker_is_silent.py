import pathlib
# §14.2, question 66. Say nothing about a store that predates the carried
# settlement marker, so an operator upgrading one is told nothing about the
# settlements it cannot tell apart.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      migrations.set("carried_settlements", "unmarked: this store predates the marker");\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
