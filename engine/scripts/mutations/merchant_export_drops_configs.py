import pathlib
# Clauses 5 and 43: a shop leaves with its ledgers in full. Leave the
# catalogue behind, which is the half a shop cannot rebuild.
p = pathlib.Path("src/node.ts"); s = p.read_text()
old = "    configs: engine.configsForPresenter(presenter),"
assert old in s
s = s.replace(old, "    configs: [],", 1)
p.write_text(s)
