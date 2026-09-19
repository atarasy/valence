import pathlib
# §16.3, question 60. Let a lapsed mandate's ceiling govern a giver.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = '    if (m.lapses_at <= now) continue;\n    if (m.ceiling_daily == null) continue;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (m.ceiling_daily == null) continue;\n', 1)
p.write_text(s)
