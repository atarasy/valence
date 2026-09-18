import pathlib
# §14.2, question 56. Keep a claim that has already lapsed, which `record`
# refuses as lapsed for ever, so the identifier holds a row nobody can act on.
# The import route's own shape check admits `lapses_at: 0`.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    if (m.lapses_at <= now) return;\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
