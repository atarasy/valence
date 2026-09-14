import pathlib
# §6.5, question 36. A physical box with goods used is charged on the
# collection's record alone. Re-anchored 2026-09-14 (question 46).
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (needsStatement(offer, missing)) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (needsStatement(offer, missing) && confirmation.signed !== undefined) {', 1)
p.write_text(s)
