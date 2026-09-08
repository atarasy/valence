import pathlib
p = pathlib.Path("src/physical.ts"); s = p.read_text()
old = "    if (row.collected_at !== null) {"
assert old in s, "anchor drifted"
s = s.replace(old, "    if (false) {", 1)
p.write_text(s)
