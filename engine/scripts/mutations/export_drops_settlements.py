import pathlib
p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
s = s.replace("    settlements,", "    settlements: [],", 1)
p.write_text(s)
