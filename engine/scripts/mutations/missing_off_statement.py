import pathlib
# §6.5, question 46 R1. A missing line is left off the statement, so the
# household never sees the merchant's claim about its home.
p = pathlib.Path('src/shared/statement.ts'); s = p.read_text()
old = '    if (c.valence === "lost" && missing.includes(c.id)) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false) {', 1)
p.write_text(s)
