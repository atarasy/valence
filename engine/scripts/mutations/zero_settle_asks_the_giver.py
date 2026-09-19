import pathlib
# §16.3, question 60. Ask for the payer's ceiling even when nothing is
# charged, so a hub that predates question 60 refuses a declined gift.
# Re-anchored 2026-09-19 for question 68, which made the payer of an offer
# with no giver the household rather than the mandate the offer names.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = """    const ceilingDaily = charged === 0
      ? null
      : await this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household);"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "    const ceilingDaily = await this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household);", 1)
p.write_text(s)
