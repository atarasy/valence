import pathlib
# Change both copies of the same-candidate guard; keep confirmation reuse
# and offer state protection so a genuinely new signature tests overwrite.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = '      if (candidate.valence !== "offered") {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      if (false) {', 1)
old = '      current.candidates.some((c) => planned.has(c.id) && c.valence !== "offered") ||'
assert s.count(old) == 1, "recheck anchor drifted"
s = s.replace(old, '      false ||', 1)
p.write_text(s)
