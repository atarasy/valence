import pathlib
# §16.3, question 62. Refuse a settlement of nothing on a day already past the
# ceiling, which traps a set that owes nothing behind its reserve. Rewritten
# 2026-09-19: once the ceiling stopped being read for a zero charge, restoring
# the comparison alone changed nothing and the mutation survived.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    const ceilingDaily = charged === 0\n      ? null\n      : offer.giver\n        ? await this.mandateSource.dailyCeilingOf(offer.giver, now)\n        : mandate?.ceiling_daily ?? null;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const ceilingDaily = offer.giver\n        ? await this.mandateSource.dailyCeilingOf(offer.giver, now)\n        : mandate?.ceiling_daily ?? null;\n', 1)
old = '    if (ceilingDaily != null && charged > 0) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (ceilingDaily != null) {\n', 1)
p.write_text(s)
