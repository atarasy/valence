import pathlib

# §10a.5. The block a merchant composed for one product is never attached to
# an offer holding that product: only the standing text travels. The household
# is then shown the merchant's general terms against a product whose terms
# differ, which is the misleading display the product key exists to prevent.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "              this.disclosures.get(disclosureKey(c.merchant, c.product)),\n"
assert a in s, "offers.ts product-block attach anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)
