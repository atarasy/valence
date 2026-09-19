import pathlib
# §12, §16.3, question 60. Read the recipient's daily ceiling for a gift the
# giver pays, as before the fifth refutation pass over question 57.
# Re-anchored 2026-09-19 after the zero-charge rule of the second pass, and
# again the same day for question 68.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = """    const ceilingDaily = charged === 0
      ? null
      : await this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household);
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """    const ceilingDaily = charged === 0 ? null : await this.mandateSource.dailyCeilingOf(offer.household);
""", 1)
p.write_text(s)
