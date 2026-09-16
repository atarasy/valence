import pathlib
# §16.2, question 56. **Re-anchored the same day**, when the refusal moved from
# presentation alone into every read of the mandate.
# Let an offer name a label its household never recorded,
# which §16.2 leaves alone as an unknown mandate: the out-of-network ceiling,
# the daily ceiling and the cooling window all stop applying at once, and the
# presenter records nothing, imports nothing and forges nothing.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      const held = await this.mandateSource.forHousehold(offer.household);\n      if (held.length > 0) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '      const held: unknown[] = [];\n      if (held.length > 0) {\n', 1))
