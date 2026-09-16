import pathlib
# §13.2, §10.5, question 55. Resolve the key a decided set is checked against
# by the mandate's own name, which is what a stranger could register first.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    const household = householdOfMandate(offer.mandate);\n    return household === undefined ? undefined : this.identities.get(household);\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    return this.identities.get(offer.mandate);\n', 1))
