import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "          if (unnamed.length > 0) {"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "          if (false) {", 1)
p.write_text(s)
