import pathlib
# Section 17.1, second break beside attest_overwrites. The refusal is kept and
# the key is written before it fires, so the second caller's key is the one
# stored and the conflict is reported afterwards. Whoever could replace an
# attested key could speak for that merchant.
p = pathlib.Path("src/shared/registry.ts"); s = p.read_text()
old = '      throw conflict("identity_exists", `a key is already attested for ${merchant}`);'
assert old in s, "attest_replaces_the_key: the anchor has drifted"
s = s.replace(old, '      this.keys.set(merchant, publicKeyPem);\n      throw conflict("identity_exists", `a key is already attested for ${merchant}`);', 1)
p.write_text(s)
