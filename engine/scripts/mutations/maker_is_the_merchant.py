import pathlib
# Clause 12. The candidate's maker is the merchant's own name again, which is
# what this field held until 2026-09-12: the specification answered "names who
# made it" with the seller's name, under the gloss "who made it: the merchant
# of record". It held only while the two were the same party, and the box
# decision of 2026-09-10 ended that.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = """        // Clause 12. Who made it, from the catalogue with the price.
        maker: entry.maker,"""
assert old in s, "maker_is_the_merchant: the anchor has drifted"
s = s.replace(old, """        maker: entry.merchant,""", 1)
p.write_text(s)
