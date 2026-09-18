import pathlib
# §14, question 61. Keep an arriving payment row whole, lines and all, and
# export it again as it came.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      .map(({ offer, presenter, settled_at, charged, receipt }) => ({ offer, presenter, settled_at, charged, receipt }));\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      .map((p) => structuredClone(p));\n', 1)
p.write_text(s)
