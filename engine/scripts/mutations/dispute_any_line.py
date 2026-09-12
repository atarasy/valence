import pathlib
# §6.5, §11.2. A household may dispute a line it kept, so the set it signed at
# the decision can be unpicked line by line at settlement and the household
# chooses what it pays for after the fact.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = '      if (candidate.valence !== "consumed") {'
assert a in s, "offers.ts not_disputable anchor has drifted"
s = s.replace(a, '      if (false) {', 1)
p.write_text(s)
