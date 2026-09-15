import pathlib
# §14.2, question 52. Replace the household's permissions and queries on import, so a second import erases them.
p = pathlib.Path('src/hub/permissions.ts'); s = p.read_text()
old = '      if (added.length) map.set(household, [...held, ...added]);'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      if (rows.length) map.set(household, [...rows]);', 1)
p.write_text(s)
