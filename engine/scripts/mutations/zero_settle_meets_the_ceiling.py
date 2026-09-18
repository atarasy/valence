import pathlib
# §16.3, question 62. Refuse a settlement of nothing on a day already past the
# ceiling, which traps a set that owes nothing behind its reserve.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (ceilingDaily != null && charged > 0) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (ceilingDaily != null) {\n', 1)
p.write_text(s)
