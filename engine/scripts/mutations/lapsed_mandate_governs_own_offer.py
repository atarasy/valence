import pathlib
# Clause 58, §16.2, question 68. Let a lapsed mandate's out-of-network ceiling
# govern a household's own offers, so a ceiling that expired months ago refuses
# under a live one.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = """    if (m.lapses_at <= now) continue;
    if (tightest === null || m.ceiling_out_of_network < tightest) tightest = m.ceiling_out_of_network;
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """    if (tightest === null || m.ceiling_out_of_network < tightest) tightest = m.ceiling_out_of_network;
""", 1)
p.write_text(s)
