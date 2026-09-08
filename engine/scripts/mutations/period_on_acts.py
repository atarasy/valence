import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace("      return json({ acts: engine.actsVisibleToGiver(giver) });",
"""      const acts = engine.actsVisibleToGiver(giver);
      return json({ acts, from: Date.now() - 2592000000, to: Date.now() });""", 1)
p.write_text(s)
