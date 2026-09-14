import pathlib
# §11.2, question 46. A first collection may leave an undecided item unnamed,
# which then stays offered for good. Re-anchored 2026-09-14 when the rule moved
# from the route into RecoveryLedger.collect.
p = pathlib.Path('src/engine/physical.ts'); s = p.read_text()
old = '    if (unnamed.length > 0) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false) {', 1)
p.write_text(s)
