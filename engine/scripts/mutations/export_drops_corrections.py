import pathlib
# §6.6, §14.2, question 70. Leave corrections out of the household's export,
# so a move brings back the uncorrected bill.
p = pathlib.Path('src/hub/node.ts'); s = p.read_text()
old = '    corrections: engine.correctionsForOffers(offers.map((o) => o.id)),\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    corrections: {},\n', 1)
p.write_text(s)
