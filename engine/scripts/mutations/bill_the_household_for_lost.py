import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace("    const charged = kept + consumed;", "    const charged = kept + consumed + lost;", 1)
p.write_text(s)
