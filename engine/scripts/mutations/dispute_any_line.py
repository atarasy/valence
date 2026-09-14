import pathlib
# §6.5, §11.2. A household may dispute a line it kept, so the set it signed can
# be unpicked at settlement. Re-anchored 2026-09-14 when the rule became
# `disputable`, which admits a missing line (question 46).
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      if (!disputable(offer, id, missing)) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      if (false) {', 1)
p.write_text(s)
