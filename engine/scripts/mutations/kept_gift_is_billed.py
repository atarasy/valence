import pathlib

# §6.2, clause 10. A gift the household kept is charged at its price, while a
# gift it used stays free. **This is what the engine did until 2026-09-12**,
# and §6.5's statement made the two disagree in the open: the screen puts 0 on
# a gift whatever its valence, so a household signed a document reading 0 and
# the ledger committed the price. Every test until that night consumed the
# gift and none kept one.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "        const amount = c.given_by ? 0 : c.unit_price * c.quantity;\n        kept += amount;\n        line(c, amount);"
assert a in s, "offers.ts kept-gift anchor has drifted"
s = s.replace(a, "        kept += c.unit_price * c.quantity;\n        line(c, c.unit_price * c.quantity);", 1)
p.write_text(s)
