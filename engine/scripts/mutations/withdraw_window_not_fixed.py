import pathlib
# §16.5, decided 2026-09-19 after the first refutation pass over question 68.
# Take a set back against the live window alone, so a lapse since the decision
# refuses the take-back `no_cooling` inside the window it was decided under.
# Re-anchored 2026-09-20 when a read that fails at a decision became
# `"unknown"` rather than a refusal, which put `known()` around each read
# of the record.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      known(this.decidedProtections.get(offer.id)?.cooling_seconds)\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      null\n', 1)
p.write_text(s)
