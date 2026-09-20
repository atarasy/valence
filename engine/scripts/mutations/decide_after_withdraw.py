import pathlib
# Q68 repeats the state guard after the protection read. Change both guards
# for this one forbidden state; removing only the first is now masked.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = '    if (offer.state !== "presented") {\n      throw conflict("bad_state", `cannot decide an offer in ${offer.state}`);\n    }'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, old.replace('offer.state !== "presented"', 'offer.state !== "presented" && offer.state !== "withdrawn"'), 1)
old = '!current || current.state !== "presented" ||'
assert s.count(old) == 1, "recheck anchor drifted"
s = s.replace(old, '!current || (current.state !== "presented" && current.state !== "withdrawn") ||', 1)
# Withdrawal also returns every candidate. Bypass its returned-line guards
# only for withdrawn offers, otherwise they mask this same forbidden reopen.
old = '      if (candidate.valence !== "offered") {'
assert s.count(old) == 1, "candidate anchor drifted"
s = s.replace(old, '      if (offer.state !== "withdrawn" && candidate.valence !== "offered") {', 1)
old = '      current.candidates.some((c) => planned.has(c.id) && c.valence !== "offered") ||'
assert s.count(old) == 1, "candidate recheck anchor drifted"
s = s.replace(old, '      (current.state !== "withdrawn" && current.candidates.some((c) => planned.has(c.id) && c.valence !== "offered")) ||', 1)
p.write_text(s)
