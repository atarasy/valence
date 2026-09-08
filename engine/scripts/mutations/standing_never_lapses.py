import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '        if (kind === "standing" && typeof lapses !== "number") {'
assert old in s, "anchor drifted"
s = s.replace(old, '        if (false) {', 1); p.write_text(s)
