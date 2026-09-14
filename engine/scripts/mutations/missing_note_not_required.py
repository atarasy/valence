import pathlib
# §11.2, question 46 R2. A missing item is recorded with no note, so the stock
# holder bears a loss with no attributable reason.
p = pathlib.Path('src/engine/physical.ts'); s = p.read_text()
old = '    if (unexplained.length > 0) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false) {', 1)
p.write_text(s)
