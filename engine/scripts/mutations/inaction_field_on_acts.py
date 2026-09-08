import pathlib
p=pathlib.Path("src/engine.ts"); s=p.read_text()
s=s.replace("    return acts.sort((a, b) => a.created_at - b.created_at);",
            "    return acts.map((a) => ({ ...a, responded: true })).sort((a, b) => a.created_at - b.created_at);",1)
p.write_text(s)
