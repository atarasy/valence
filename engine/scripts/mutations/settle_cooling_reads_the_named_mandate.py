import pathlib
# §16.5, question 68. Read the cooling window of the mandate the offer names
# rather than the longest the household holds, so a second label with a short
# window settles a set the first label would still have held.
# Re-anchored when question 68 was rebased onto questions 65 to 67 (the `now`
# argument).
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = """    const coolingSeconds = await this.mandateSource.coolingSecondsOf(offer.household, now);
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """    const coolingSeconds = (await this.mandateSource.get(offer.mandate))?.cooling_seconds ?? null;
""", 1)
p.write_text(s)
