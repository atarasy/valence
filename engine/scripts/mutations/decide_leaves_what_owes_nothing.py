import pathlib
# §6.4, question 62. A set decided with every line returned keeps its reserve
# until the presenter settles it at 0, which nothing obliges it to do.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (offer.state === "decided") await this.settleIfNothingOwed(offer, now);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
