import pathlib
# §16.5, question 68. Read the cooling window of the mandate the offer names
# rather than the longest the household holds, so a second label with a short
# window settles a set the first label would still have held.
# Re-anchored when question 68 was rebased onto questions 65 to 67 (the `now`
# argument).
# Re-anchored 2026-09-19 when the lapse rules fixed a decided set's window and
# ceiling at its decision: the rule is now read in two places, the decision
# and the settlement, and a break of one alone leaves the other enforcing it.
# Re-anchored 2026-09-20 when a read that fails at a decision became
# `"unknown"` rather than a refusal, which put `known()` around each read
# of the record.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    const coolingSeconds = longerWindow(\n      await this.mandateSource.coolingSecondsOf(offer.household, now),'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const coolingSeconds = longerWindow(\n      (await this.mandateSource.get(offer.mandate))?.cooling_seconds ?? null,', 1)
old = '    const cooling_seconds = await readOrUnknown(() => this.mandateSource.coolingSecondsOf(offer.household, now));'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const cooling_seconds = await readOrUnknown(async () => (await this.mandateSource.get(offer.mandate))?.cooling_seconds ?? null);', 1)
p.write_text(s)
