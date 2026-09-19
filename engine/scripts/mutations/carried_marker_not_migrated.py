import pathlib
# Question 66. Skip the one-time pass that marks, in a store written before
# the marker, the settlements with no reservation on this ledger, so a payment
# a recipient's import planted comes back into its giver's record on upgrade.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '        for (const id of settled) if (ledger.get(id) === undefined) this.carriedSettlements.set(id, true);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
