import pathlib

# §10.5. Check every signature the way ed25519 is checked, whatever key it is
# checked against. This is what the reference did until 2026-09-11: an
# authenticator on the P-256 curve, which is what most phones and laptops
# carry, was refused rather than accepted, and a member who joined with a
# passkey could confirm nothing.

p = pathlib.Path("src/shared/decisions.ts"); s = p.read_text()
a = '    return verify(key.asymmetricKeyType === "ed25519" ? null : "sha256", data, key, signature);'
assert a in s, "decisions.ts verifyBy anchor has drifted"
s = s.replace(a, "    return verify(null, data, key, signature);", 1)
p.write_text(s)
