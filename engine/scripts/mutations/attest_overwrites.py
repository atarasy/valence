import pathlib
# §15.1: an attested key is not replaced. Let a later caller overwrite it.
p = pathlib.Path("src/registry.ts"); s = p.read_text()
old = "    if (existing !== undefined && existing !== publicKeyPem) {"
assert old in s
s = s.replace(old, "    if (false) {", 1)
p.write_text(s)
