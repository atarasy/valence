import pathlib
# Clause 12: every line of every receipt names who made it. Blank the maker on
# each line, keeping the merchant, which is the receipt saying who took the
# money and not who made the goods.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = 'lines.push({ candidate: c.id, product: c.product, merchant: c.merchant, maker: c.maker, ships: c.ships, valence: c.valence, amount });'
assert old in s, "receipt_line_without_maker: the anchor has drifted"
s = s.replace(old, 'lines.push({ candidate: c.id, product: c.product, merchant: c.merchant, maker: "", ships: c.ships, valence: c.valence, amount });', 1)
p.write_text(s)
