import pathlib
# §14.2, question 52. Replace the household's recovery log on import, so a second import can empty it.
p = pathlib.Path('src/hub/node.ts'); s = p.read_text()
old = '    if (added.length) this.log.set(household, [...held, ...added]);'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (records.length) this.log.set(household, [...records]);', 1)
p.write_text(s)
