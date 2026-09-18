import pathlib
# §12, question 64. Present a gift with no giver's signature, reserving
# against a household that took no act.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (offer.giver) {\n      if (!giverSignature) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (offer.giver && giverSignature) {\n      if (!giverSignature) {', 1)
p.write_text(s)
