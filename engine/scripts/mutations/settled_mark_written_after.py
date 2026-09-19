import pathlib
# §14.2, question 66. Write the settlement before the mark that says it was
# made here, so a failure between the two leaves one this host made unmarked.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    this.settledHere.set(offer.id, true);\n    this.settlements.set(offer.id, settlement);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    this.settlements.set(offer.id, settlement);\n    this.settledHere.set(offer.id, true);\n', 1)
p.write_text(s)
