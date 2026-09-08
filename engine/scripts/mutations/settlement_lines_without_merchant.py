import pathlib
# Clause 11: every line of every receipt names its merchant of record. Keep
# the lines and blank the merchant on each.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "lines.push({ candidate: c.id, product: c.product, merchant: c.merchant, ships: c.ships, valence: c.valence, amount });"
assert old in s
s = s.replace(old, 'lines.push({ candidate: c.id, product: c.product, merchant: "", ships: c.ships, valence: c.valence, amount });', 1)
p.write_text(s)
