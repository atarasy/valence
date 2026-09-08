import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "      return json({ acts: engine.actsVisibleToGiver(giver) });"
assert old in s, "anchor drifted"
s = s.replace(old, """      // Distinguishes a key nobody has attested from a giver whose
      // recipients have not acted, which answers a question about a person.
      if (!engine.isKnownKey(giver)) throw notFound("no such giver");
      return json({ acts: engine.actsVisibleToGiver(giver) });""", 1)
p.write_text(s)
