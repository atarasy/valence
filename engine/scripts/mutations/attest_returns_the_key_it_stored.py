import pathlib
# Clause 2, second break beside attest_returns_private_key. Attestation
# answers with the key it recorded, which is what turns recording a key
# somebody brought into issuing one: a caller who reads a key back from this
# route can believe the registry is where keys come from.
#
# Rewritten 2026-09-11. The first version changed only the return type of
# `Registry.attest`, from `void` to an object, and the route went on answering
# `{ ok: true }`. bun strips types, so nothing at runtime differed and the run
# reported SURVIVED for a mutation with nothing to catch. `mutate.sh` asks
# whether the text of src changed, and a type annotation satisfies that.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = """      registry.attest(
        requireString(raw, "merchant", "attest"),
        requireString(raw, "public_key", "attest")
      );
      return json({ ok: true }, 201);"""
assert old in s, "attest_returns_the_key_it_stored: the anchor has drifted"
new = """      registry.attest(
        requireString(raw, "merchant", "attest"),
        requireString(raw, "public_key", "attest")
      );
      return json({ ok: true, public_key: requireString(raw, "public_key", "attest") }, 201);"""
s = s.replace(old, new, 1)
p.write_text(s)
