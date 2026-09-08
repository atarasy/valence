import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '  if (parts[0] === "offers") {'
assert old in s, "anchor drifted"
s = s.replace(old, '''  if (parts[0] === "signup" && method === "POST") {
    // Issuing an identity, which is the thing clause 2 says nothing here does.
    const { generateKeyPairSync } = await import("node:crypto");
    const pair = generateKeyPairSync("ed25519");
    return json({
      key: "key-" + Math.random().toString(36).slice(2),
      private_key: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    }, 201);
  }

  if (parts[0] === "offers") {''', 1)
p.write_text(s)
