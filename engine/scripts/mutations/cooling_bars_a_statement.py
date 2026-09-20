import pathlib
# §16.5, question 42. A cooling window bars the household's signature over a
# settlement statement, which is what the engine did until 2026-09-13.
# Re-anchored 2026-09-14 when needsStatement gained the missing list.
# Re-anchored 2026-09-19 for question 68.
# Re-anchored 2026-09-20 when the window stopped being read at all for a
# statement, so that a hub predating question 68 no longer blocks deliveries.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = "    if (!needsStatement(offer, missing) && offer.decided_at !== null) {"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "    if (offer.decided_at !== null) {", 1)
p.write_text(s)
