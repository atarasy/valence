import pathlib
# Clause 58, §16.5, question 68. Let a lapsed mandate's cooling window govern,
# so a set waits behind a window the household stopped renewing.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = """    if (m.lapses_at <= now) continue;
    if (m.cooling_seconds == null) continue;
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """    if (m.cooling_seconds == null) continue;
""", 1)
p.write_text(s)
