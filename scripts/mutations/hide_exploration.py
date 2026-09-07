import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace("    is_exploration: c.is_exploration,\n", "", 1)
p.write_text(s)
