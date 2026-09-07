import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
s = s.replace("    presenter: o.presenter,\n", "", 1)
p.write_text(s)
