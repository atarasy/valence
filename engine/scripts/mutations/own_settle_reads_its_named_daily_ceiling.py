import pathlib
# §16.3, question 68. Read the tightest daily ceiling for a gift's giver alone,
# as question 60 left it: a household's own settlement then reads nothing but
# the mandate the offer names, and a second label removes the ceiling.
# Re-anchored when question 68 was rebased onto questions 65 to 67 (the `now`
# argument).
# Re-anchored 2026-09-19 when the lapse rules fixed a decided set's window and
# ceiling at its decision: the rule is now read in two places, the decision
# and the settlement, and a break of one alone leaves the other enforcing it.
# Re-anchored 2026-09-20 when a read that fails at a decision became
# `"unknown"` rather than a refusal, which put `known()` around each read
# of the record.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '          await this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household, now),\n          known(fixed?.ceiling_daily)'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '          (offer.giver ? await this.mandateSource.dailyCeilingOf(offer.giver, now) : (await this.mandateSource.get(offer.mandate))?.ceiling_daily ?? null),\n          known(fixed?.ceiling_daily)', 1)
old = '    const ceiling_daily = await readOrUnknown(() => this.mandateSource.dailyCeilingOf(offer.giver ?? offer.household, now));'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const ceiling_daily = await readOrUnknown(async () => offer.giver ? this.mandateSource.dailyCeilingOf(offer.giver, now) : (await this.mandateSource.get(offer.mandate))?.ceiling_daily ?? null);', 1)
p.write_text(s)
