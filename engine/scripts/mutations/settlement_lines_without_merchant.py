import pathlib
# Clause 11: every line of every receipt names its merchant of record. Keep
# the lines and blank the merchant on each.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
# Re-anchored 2026-09-12, when the line gained a maker.
old = "lines.push({ candidate: c.id, product: c.product, merchant: c.merchant, maker: c.maker, ships: c.ships, valence: c.valence, amount });"
assert old in s
s = s.replace(old, 'lines.push({ candidate: c.id, product: c.product, merchant: "", maker: c.maker, ships: c.ships, valence: c.valence, amount });', 1)
p.write_text(s)
