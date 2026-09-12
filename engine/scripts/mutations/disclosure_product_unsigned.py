import pathlib

# §10a.5. The product is left out of the bytes a merchant signs, so a block
# signed for one product verifies when re-filed under another, or under the
# merchant as a whole, where its narrower terms would be shown against every
# product the merchant sells.

p = pathlib.Path("src/shared/disclosure.ts"); s = p.read_text()
a = '    encodeURIComponent(d.product ?? ""),\n'
assert a in s, "disclosure.ts canonical product anchor has drifted"
s = s.replace(a, "", 1)
p.write_text(s)
