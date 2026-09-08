import pathlib
p = pathlib.Path("src/engine/physical.ts"); s = p.read_text()
old = "    } else if (overdue) {"
assert old in s, "anchor drifted"
s = s.replace(old, "    } else if (false) {", 1)
p.write_text(s)
