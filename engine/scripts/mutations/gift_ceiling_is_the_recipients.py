import pathlib
# §12, §16.3, question 60. Read the recipient's daily ceiling for a gift the
# giver pays, as before the fifth refutation pass over question 57.
# Re-anchored 2026-09-19 after the zero-charge rule of the second pass, again
# the same day for question 68, and again when question 68 was rebased onto
# questions 65 to 67, whose source reads its rows against the engine's `now`.
# Re-anchored 2026-09-19 when the lapse rules fixed a decided set's window and
# ceiling at its decision: the rule is now read in two places, the decision
# and the settlement, and a break of one alone leaves the other enforcing it.
# Re-anchored 2026-09-20 for bounded reads and the last-reading fallback.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '          await this.dailyCeilingRead(offer.giver ?? offer.household, now),\n          known(fixed?.ceiling_daily)'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '          await this.dailyCeilingRead(offer.household, now),\n          known(fixed?.ceiling_daily)', 1)
old = '      const payer = offer.giver ?? offer.household;'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      const payer = offer.household;', 1)
p.write_text(s)
