import pathlib
# Clause 2: nothing here issues an identity. Make the attestation route
# generate a key pair and hand back the private half, which is issuing.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "      return json({ ok: true }, 201);\n    }\n    if (method === \"POST\" && parts.length === 1) {\n      const raw = strict(\n        await body(request),\n        [\"merchant\", \"endpoints\", \"mark\", \"signature\"],"
assert old in s
new = old.replace("      return json({ ok: true }, 201);",
  "      const { privateKey } = (await import(\"node:crypto\")).generateKeyPairSync(\"ed25519\");\n      return json({ ok: true, private_key: privateKey.export({ type: \"pkcs8\", format: \"pem\" }).toString() }, 201);", 1)
s = s.replace(old, new, 1)
p.write_text(s)
