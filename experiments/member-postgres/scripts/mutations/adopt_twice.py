import pathlib
# §13.2, question 55. Let a principal that already has a household adopt
# another one, so the household a session carries can change under it.
p = pathlib.Path('authority.ts'); s = p.read_text()
old = '        const changed = principals.updateWhere(id, v => v.household === null && v.disabled === 0, { household });'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        const changed = principals.updateWhere(id, v => v.disabled === 0, { household });', 1)
p.write_text(s)
