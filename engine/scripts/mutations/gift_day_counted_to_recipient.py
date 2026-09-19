import pathlib
# §12, §16.3, question 60. Count a gift's charge to the recipient's day while
# the giver pays.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      household: settlement.payer,\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      household: this.offers.get(settlement.offer)!.household,\n', 1)
p.write_text(s)
