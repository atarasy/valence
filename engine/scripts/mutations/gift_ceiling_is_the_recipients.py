import pathlib
# §12, §16.3, question 60. Read the recipient's daily ceiling for a gift the
# giver pays, as before the fifth refutation pass over question 57.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    const ceilingDaily = offer.giver\n      ? await this.mandateSource.dailyCeilingOf(offer.giver)\n      : mandate?.ceiling_daily ?? null;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const ceilingDaily = mandate?.ceiling_daily ?? null;\n', 1)
p.write_text(s)
