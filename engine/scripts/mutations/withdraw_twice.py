import pathlib
# §2.1: withdrawn is terminal too. Let a withdrawn offer be withdrawn again.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = '    if (offer.state !== "drafted" && offer.state !== "presented") {'
assert old in s
s = s.replace(old, '    if (offer.state !== "drafted" && offer.state !== "presented" && offer.state !== "withdrawn") {', 1)
p.write_text(s)
