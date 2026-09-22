import pathlib
# §6.6, question 70. Forget that a correction with this id is already held,
# so a retry becomes a second reduction.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    const same = existing.find((e) => e.id === c.id);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const same = undefined as Correction | undefined;\n', 1)
p.write_text(s)
