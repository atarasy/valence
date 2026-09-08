import pathlib
p=pathlib.Path("src/http.ts"); s=p.read_text()
s=s.replace("      return json({ acts: engine.actsVisibleToGiver(giver) });",
"""      const acts = engine.actsVisibleToGiver(giver);
      if (acts.length === 0) throw notFound("no such giver");
      return json({ acts });""",1)
p.write_text(s)
