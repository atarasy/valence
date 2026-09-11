import pathlib
# §16.1. Join the co-signer list without escaping its items, which is what the
# canonical form did until 2026-09-11. `["a","b"]` and `["a,b"]` are then the
# same bytes, so whoever relays a change can fuse two co-signers into a name
# nobody holds, after which no loosening can ever be signed, and the signature
# the person made still verifies. Measured by an adversarial pass: the
# protection went and the signature stayed good.
#
# Re-anchored 2026-09-12, when §16.4 was withdrawn and the category list left
# the form. The same defect lived on both lists; the co-signer list is the one
# that remains.

p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
a = '      [...m.co_signers].sort().map(encodeURIComponent).join(","),'
assert a in s, "mandates.ts co-signer join anchor has drifted"
s = s.replace(a, '      [...m.co_signers].sort().join(","),', 1)
p.write_text(s)
