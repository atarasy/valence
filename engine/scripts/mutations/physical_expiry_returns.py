import pathlib
# §11: apply the digital expiry rule to physical goods after expiry.
p = pathlib.Path("src/engine/offers.ts")
s = p.read_text()
old = '    if (offer.expires_at > now) return false;\n    if (offer.binding === "physical") {'
assert s.count(old) == 1, "physical expiry anchor drifted"
s = s.replace(old, '    if (offer.expires_at > now) return false;\n    if (false) {', 1)
p.write_text(s)
