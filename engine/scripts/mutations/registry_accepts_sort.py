import pathlib
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '        if (key !== "protocol" && key !== "mark") {'
assert old in s, "anchor drifted"
s = s.replace(old, '        if (key !== "protocol" && key !== "mark" && key !== "sort" && key !== "order" && key !== "orderBy") {', 1)
p.write_text(s)
