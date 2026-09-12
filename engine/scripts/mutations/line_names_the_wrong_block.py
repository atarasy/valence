import pathlib

# §10a.5. Every line names the merchant's standing text as the block that
# governs it, whatever the offer carries for that product. One screen holds
# several merchants' blocks and a product's own terms beside them, and a
# household reading a product's line is pointed at the general terms: the
# misleading display the product key exists to prevent, now by the join rather
# than by the block.

p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
a = "  return { merchant, product: forProduct ? product : null };"
assert a in s, "approval.ts governing anchor has drifted"
s = s.replace(a, "  return { merchant, product: null };", 1)
p.write_text(s)
