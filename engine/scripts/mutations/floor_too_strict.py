import pathlib
p = pathlib.Path("src/engine.ts"); s = p.read_text()
s = s.replace("    if (marked < required) {", "    if (marked <= required) {", 1)
p.write_text(s)
