import pathlib
# §10a.5, §14.2. The check at the decision goes back to verifying one block
# per candidate, which is the standing text, so a product block an import
# carried reaches the approval and the settlement statement unverified: signed
# for another product, or signed by nobody, and rendered as the merchant's word.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "    for (const block of offer.disclosures) {"
assert a in s, "offers.ts disclosure verify loop anchor has drifted"
s = s.replace(a, "    for (const block of offer.disclosures.filter((d) => d.product === null)) {", 1)
p.write_text(s)
