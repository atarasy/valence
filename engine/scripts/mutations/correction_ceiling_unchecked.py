import pathlib
# §6.6, question 70. Let corrections together lower more than was paid.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (already + c.amount > ceiling) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false && already + c.amount > ceiling) {\n', 1)
p.write_text(s)
