import pathlib
# §16.3, question 60. Let a lapsed mandate's ceiling govern a giver.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = '    if (m.lapses_at <= now) continue;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
