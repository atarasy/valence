import pathlib
# §12, §16.3, question 60. Read the recipient's daily ceiling for a gift the
# giver pays, as before the fifth refutation pass over question 57.
# Re-anchored 2026-09-19 after the zero-charge rule of the second pass.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    const ceilingDaily = charged === 0\n      ? null\n      : offer.giver\n        ? await this.mandateSource.dailyCeilingOf(offer.giver)\n        : mandate?.ceiling_daily ?? null;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const ceilingDaily = charged === 0 ? null : mandate?.ceiling_daily ?? null;\n', 1)
p.write_text(s)
