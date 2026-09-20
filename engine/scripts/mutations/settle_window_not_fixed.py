import pathlib
# §16.5, decided 2026-09-19 after the first refutation pass over question 68.
# Settle against the live window alone, so a lapse since the decision ends a
# window already running and the set settles at once.
# Re-anchored 2026-09-20 when a read that fails at a decision became
# `"unknown"` rather than a refusal, which put `known()` around each read
# of the record.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      known(fixed?.cooling_seconds)\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      null\n', 1)
p.write_text(s)
