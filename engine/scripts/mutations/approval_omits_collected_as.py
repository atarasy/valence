import pathlib

# §3, question 48. The approval carries collected_as as null, which is the surface a household decides from.

p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
a = '        collected_as: collectedAs(engine.recoveries.for(offer.id), c.id),'
assert a in s, "src/hub/approval.ts approval_omits_collected_as anchor has drifted"
s = s.replace(a, '        collected_as: null,', 1)
p.write_text(s)
