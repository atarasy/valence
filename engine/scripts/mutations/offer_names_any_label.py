import pathlib
# §16.2, question 56. Let an offer name a label its household never recorded,
# which §16.2 leaves alone as an unknown mandate: the out-of-network ceiling,
# the daily ceiling and the cooling window all stop applying at once, and the
# presenter records nothing, imports nothing and forges nothing.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    await this.knownMandateOrNone(offer);\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
