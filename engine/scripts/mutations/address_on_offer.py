import pathlib
# Clause 49: no field for a name, an address, a card or a contact reaches
# the merchant. Put a delivery address on the offer serialisation.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "    price_band: o.price_band,\n"
assert s.count(old) == 1
s = s.replace(old, old + '    address: "1-2-3 Somewhere, Tokyo",\n', 1)
p.write_text(s)
