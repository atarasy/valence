import pathlib
# §16.3, question 68. Read the tightest daily ceiling for a gift's giver alone,
# as question 60 left it: a household's own settlement then reads nothing but
# the mandate the offer names, and a second label removes the ceiling.
# Re-anchored when question 68 was rebased onto questions 65 to 67 (the `now`
# argument).
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = """      : await this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household, now);
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """      : offer.giver
        ? await this.mandateSource.dailyCeilingOf(offer.giver, now)
        : (await this.mandateSource.get(offer.mandate))?.ceiling_daily ?? null;
""", 1)
p.write_text(s)
