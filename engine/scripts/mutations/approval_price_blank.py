import pathlib

# §10a.5, clause 10. The approval surface shows every candidate at a unit price
# of zero. The price a person signs against is the one on this screen, and a
# hub that draws it from anywhere but the offer's frozen terms has let a
# party that is not the merchant state the price.

p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
a = "        unit_price: c.unit_price,"
assert a in s, "approval.ts unit_price anchor has drifted"
s = s.replace(a, "        unit_price: 0,", 1)
p.write_text(s)
