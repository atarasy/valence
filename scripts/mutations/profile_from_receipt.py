import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace("    received.push({ edge: edge.id, at: edge.created_at });",
              "    received.push({ edge: edge.id, at: edge.created_at, preference: edge.product } as never);", 1)
p.write_text(s)
