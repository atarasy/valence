import pathlib
# §6.4, question 62. Settle at once a set that owes something, taking the
# charge out of the presenter's hands and the household's statement.
# Re-anchored 2026-09-19 after gifts kept were counted as owing nothing.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (owes || this.settlements.has(offer.id)) return false;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (this.settlements.has(offer.id)) return false;\n', 1)
p.write_text(s)
