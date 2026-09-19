import pathlib
# §16.5, question 42. A cooling window bars the household's signature over a
# settlement statement, which is what the engine did until 2026-09-13.
# Re-anchored 2026-09-14 when needsStatement gained the missing list.
# Re-anchored 2026-09-19 for question 68.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (!needsStatement(offer, missing) && coolingSeconds != null && offer.decided_at !== null) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (coolingSeconds != null && offer.decided_at !== null) {', 1)
p.write_text(s)
