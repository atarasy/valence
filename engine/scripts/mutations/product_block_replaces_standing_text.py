import pathlib

# §10a.5. A product block is filed under the merchant's own key, so
# registering one replaces the merchant's standing text, and every other
# product of that merchant is then shown one product's terms as the whole of
# the disclosure.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "    this.disclosures.set(disclosureKey(d.merchant, d.product), stored);"
assert a in s, "offers.ts disclosure store anchor has drifted"
s = s.replace(a, "    this.disclosures.set(disclosureKey(d.merchant, null), stored);", 1)
p.write_text(s)
