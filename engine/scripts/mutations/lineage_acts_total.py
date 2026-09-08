import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace("      return json({ acts: engine.actsVisibleToGiver(giver) });",
              "      const acts = engine.actsVisibleToGiver(giver);\n"
              "      return json({ acts, network_size: acts.length });", 1)
p.write_text(s)
