import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "      return json({ acts: engine.actsVisibleToGiver(giver) });"
assert old in s, "anchor drifted"
s = s.replace(old, """      const acts = engine.actsVisibleToGiver(giver);
      // The timing channel: a store consulted only when there is something in
      // it answers the question by how long it takes.
      if (acts.length > 0) {
        const until = Date.now() + 120;
        while (Date.now() < until) {}
      }
      return json({ acts });""", 1)
p.write_text(s)
