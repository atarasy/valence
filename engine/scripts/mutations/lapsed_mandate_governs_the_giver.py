import pathlib
# §16.3, question 60. Let a lapsed mandate's ceiling govern a giver.
# Re-anchored 2026-09-19: question 68 added two more helpers with the same
# lapse skip, so the bare line is no longer unique to this one.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = """    if (m.lapses_at <= now) continue;
    if (m.ceiling_daily == null) continue;
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """    if (m.ceiling_daily == null) continue;
""", 1)
p.write_text(s)
