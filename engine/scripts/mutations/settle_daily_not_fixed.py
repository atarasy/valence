import pathlib
# §16.3, decided 2026-09-19 after the first refutation pass over question 68.
# Settle against the live daily ceiling alone, so a lapse since the decision
# removes the ceiling of a set decided under it.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '          fixed?.ceiling_daily ?? null\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '          null\n', 1)
p.write_text(s)
