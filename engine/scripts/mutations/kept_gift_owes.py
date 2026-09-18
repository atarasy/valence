import pathlib
# §6.4, clause 10, question 62. Treat a set of gifts kept as one that owes a
# settlement, so it waits for its presenter like a decline did.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      ((c.valence === "kept" || c.valence === "defaulted") && !c.given_by) || c.valence === "consumed" || c.valence === "lost");'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      c.valence === "kept" || c.valence === "defaulted" || c.valence === "consumed" || c.valence === "lost");', 1)
p.write_text(s)
