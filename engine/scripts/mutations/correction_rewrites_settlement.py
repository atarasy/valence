import pathlib
# §6.6, question 70. Lower the signed settlement itself instead of appending.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    this.corrections.set(c.offer, [...existing, stored]);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, old + '    this.settlements.set(c.offer, { ...settlement, charged: settlement.charged - c.amount });\n', 1)
p.write_text(s)
