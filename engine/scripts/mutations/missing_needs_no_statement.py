import pathlib
# §6.5, question 46 R1. A box whose only collection line is missing settles with
# no signature, so the household never sees it.
p = pathlib.Path('src/shared/statement.ts'); s = p.read_text()
old = '    offer.candidates.some((c) => c.valence === "consumed" || (c.valence === "lost" && missing.includes(c.id)))'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    offer.candidates.some((c) => c.valence === "consumed")', 1)
p.write_text(s)
