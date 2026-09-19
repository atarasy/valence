import pathlib
# §16.5, question 68. The same at the other end of the window: a set under a
# second label can no longer be taken back inside the window the household set
# on its first.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = """    const cooling = await this.mandateSource.coolingSecondsOf(offer.household);
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """    const cooling = (await this.mandateSource.get(offer.mandate))?.cooling_seconds ?? null;
""", 1)
p.write_text(s)
