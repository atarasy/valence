import pathlib
# §16.3, question 68. Read the tightest daily ceiling for a gift's giver alone,
# as question 60 left it: a household's own settlement then reads nothing but
# the mandate the offer names, and a second label removes the ceiling.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = """      : await this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household);
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """      : offer.giver
        ? await this.mandateSource.dailyCeilingOf(offer.giver)
        : (await this.mandateSource.get(offer.mandate))?.ceiling_daily ?? null;
""", 1)
p.write_text(s)
