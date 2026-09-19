import pathlib
# §16.3, question 60. Ask for the payer's ceiling even when nothing is
# charged, so a hub that predates question 60 refuses a declined gift.
# Re-anchored 2026-09-19 for question 68, which made the payer of an offer
# with no giver the household rather than the mandate the offer names, and
# again when question 68 was rebased onto questions 65 to 67 (the `now`
# argument), and again when the lapse rules combined the live ceiling with
# the one fixed at the decision.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    const ceilingDaily = charged === 0\n      ? null\n      : tighterCeiling('
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const ceilingDaily = tighterCeiling(', 1)
p.write_text(s)
