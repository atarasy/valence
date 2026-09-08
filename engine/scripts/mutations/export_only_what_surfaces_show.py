import pathlib
p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
s = s.replace("    lineage: engine.edgesTouching(household),",
              "    lineage: engine.actsVisibleToGiver(household),", 1)
p.write_text(s)
