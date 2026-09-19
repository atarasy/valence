import pathlib
# §16.3, question 62. Refuse a settlement of nothing on a day already past the
# ceiling, which traps a set that owes nothing behind its reserve. Rewritten
# 2026-09-19: once the ceiling stopped being read for a zero charge, restoring
# the comparison alone changed nothing and the mutation survived.
# Re-anchored 2026-09-19 for question 68, and again when question 68 was
# rebased onto questions 65 to 67 (the `now` argument).
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = """    const ceilingDaily = charged === 0
      ? null
      : await this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household, now);
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """    const ceilingDaily = await this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household, now);
""", 1)
old = '    if (ceilingDaily != null && charged > 0) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (ceilingDaily != null) {\n', 1)
p.write_text(s)
