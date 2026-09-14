import pathlib
# §6.5, question 46. The statement shows a missing line without the
# collection's note, so the household cannot read what it may contest.
p = pathlib.Path('src/hub/statement.ts'); s = p.read_text()
old = '        note: l.valence === "lost" ? recovery?.missing_notes?.[c.id] ?? null : null,'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        note: null,', 1)
p.write_text(s)
