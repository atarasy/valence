import pathlib
# §12, §14, question 66. Take a reserve on the ledger as the proof that a
# settlement was made here, which a ledger whose holds are memory only forgets.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      .filter((o) => o.giver === household && !this.carriedSettlements.has(o.id))\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      .filter((o) => o.giver === household && this.ledger.get(o.id) !== undefined)\n', 1)
old = '    if (this.carriedSettlements.has(settlement.offer)) return settlement;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (this.ledger.get(settlement.offer) === undefined) return settlement;\n', 1)
p.write_text(s)
