import pathlib
# Clause 46, question 65. Count a line a maker gave towards the out-of-network
# ceiling, though nobody pays for it.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '        .filter((c) => !c.given_by && !(this.config.isInNetwork ?? (() => true))(c.merchant))\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        .filter((c) => !(this.config.isInNetwork ?? (() => true))(c.merchant))\n', 1)
p.write_text(s)
