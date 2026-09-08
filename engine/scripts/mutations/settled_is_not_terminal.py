import pathlib
# §2.1: settled is terminal. Let a settled offer be withdrawn out of it.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = '    if (offer.state !== "drafted" && offer.state !== "presented") {'
assert old in s
s = s.replace(old, '    if (offer.state !== "drafted" && offer.state !== "presented" && offer.state !== "settled") {', 1)
p.write_text(s)
