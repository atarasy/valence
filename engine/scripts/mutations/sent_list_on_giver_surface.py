import pathlib
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
s = s.replace('      if (edge.kind === "gift") continue;', '      // mutation: the giver sees their own gifts beside the acts', 1)
s = s.replace("      if (edge.to !== giver) continue;", "      if (edge.to !== giver && edge.from !== giver) continue;", 1)
p.write_text(s)
