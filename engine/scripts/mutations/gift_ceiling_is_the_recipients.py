import pathlib
# §12, §16.3, question 60. Read the recipient's daily ceiling for a gift the
# giver pays, as before the fifth refutation pass over question 57.
# Re-anchored 2026-09-19 after the zero-charge rule of the second pass, again
# the same day for question 68, and again when question 68 was rebased onto
# questions 65 to 67, whose source reads its rows against the engine's `now`.
# Re-anchored 2026-09-19 when the lapse rules fixed a decided set's window and
# ceiling at its decision: the rule is now read in two places, the decision
# and the settlement, and a break of one alone leaves the other enforcing it.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '          await this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household, now),\n          fixed?.ceiling_daily ?? null'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '          await this.mandateSource.dailyCeilingOf(offer.household, now),\n          fixed?.ceiling_daily ?? null', 1)
old = '    const ceiling_daily = await this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household, now);'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const ceiling_daily = await this.mandateSource.dailyCeilingOf(offer.household, now);', 1)
p.write_text(s)
