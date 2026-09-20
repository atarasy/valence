import pathlib
# §16.1, clause 58, decided 2026-09-19 after the first refutation pass over
# question 68. Take a lapse any distance out, so a mandate naming a co-signer
# nobody holds binds every label of its household until the year 9999.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = "    if (mandate.lapses_at > now + MAX_LAPSE_MS) {"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "    if (false && mandate.lapses_at > now + MAX_LAPSE_MS) {", 1)
p.write_text(s)
