import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace("        at: mine ? null : edge.created_at,\n        product: mine ? null : edge.product,",
              "        at: edge.created_at,\n        product: edge.product,", 1)
p.write_text(s)
