import pathlib
# §6.4, §11.2, question 62. Settle at nothing a box the household called
# returned before anyone collected it, after which the collection is refused on
# a settled offer: the household eats the box for free.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (offer.binding === "physical" && (this.recoveries.for(offer.id)?.collected_at ?? null) === null) return false;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
