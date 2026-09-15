import pathlib
# §14.2, question 52. Give up after the edge's own id, so occupying one id
# refuses the whole move of the household that holds the edge.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    for (let n = 0; n < 32; n += 1) {'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    for (let n = 0; n < 1; n += 1) {', 1))
