import pathlib
p=pathlib.Path("src/engine.ts"); s=p.read_text()
s=s.replace("    received.push({ ref: randomUUID(), at: edge.created_at });",
            "    received.push({ ref: randomUUID(), at: edge.created_at, due: edge.created_at + 604800000 } as never);",1)
p.write_text(s)
