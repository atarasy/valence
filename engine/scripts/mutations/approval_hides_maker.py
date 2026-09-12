import pathlib
# Clauses 12, 23: the screen the person signs from names maker, carrier and band. Drop them.
p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
# Re-anchored 2026-09-12, when the maker went onto the screen between the merchant and the carrier.
old = "        merchant: c.merchant,\n        maker: c.maker,\n        ships: c.ships,\n"
assert old in s
s = s.replace(old, "", 1)
old2 = "      price_band: offer.price_band,\n"
assert old2 in s
s = s.replace(old2, "      price_band: null,\n", 1)
p.write_text(s)
