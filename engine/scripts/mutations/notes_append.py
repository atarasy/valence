import pathlib
# Clause 31: one line per author. Append a second.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "    if (list.some((n) => n.author === input.author)) {"
assert old in s
s = s.replace(old, "    if (false) {", 1)
p.write_text(s)
