import pathlib
# §16.3, question 60. Ask for the giver's ceiling even when nothing is
# charged, so a hub that predates question 60 refuses a declined gift.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    const ceilingDaily = charged === 0\n      ? null\n      : offer.giver'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const ceilingDaily = offer.giver', 1)
p.write_text(s)
