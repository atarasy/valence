import pathlib

# §6.5, question 36. A physical box with goods used is charged on the
# collection's record alone, with no signature from the household. This is
# what the reference did until 2026-09-12, and the concept's own legal reading
# says it costs the case for distance selling: the sale would be concluded
# where the goods are, by a third party's record.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "    if (needsStatement(offer)) {"
assert a in s, "offers.ts needsStatement anchor has drifted"
s = s.replace(a, "    if (needsStatement(offer) && confirmation.signed !== undefined) {", 1)
p.write_text(s)
