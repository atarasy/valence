import pathlib

# §16.1. Join the two lists without escaping their items, which is what the
# canonical form did until 2026-09-11. `["coffee","tea"]` and `["coffee,tea"]`
# are then the same bytes, so whoever relays a change can drop a category from
# what needs a second signature, or fuse two co-signers into a name nobody
# holds, and the signature the person made still verifies. Measured by an
# adversarial pass: the protection went and the signature stayed good.

p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
a = '      [...m.co_sign_categories].sort().map(encodeURIComponent).join(","),'
assert a in s, "mandates.ts category join anchor has drifted"
s = s.replace(a, '      [...m.co_sign_categories].sort().join(","),', 1)
p.write_text(s)
