import pathlib
# §6.5, question 46. Every lost line goes on the statement, including those the
# deadline made, about which nobody said anything regarding the home.
p = pathlib.Path('src/shared/statement.ts'); s = p.read_text()
old = '    if (c.valence === "lost" && missing.includes(c.id)) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (c.valence === "lost") {', 1)
p.write_text(s)
