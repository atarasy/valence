import pathlib
# §13.2, question 55. Let an offer name a household that is not a key and a
# mandate that is not that household's, which is how a presenter reaches a set
# it can confirm itself.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (householdOfMandate(input.mandate) !== input.household) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    if (false) {\n', 1))
