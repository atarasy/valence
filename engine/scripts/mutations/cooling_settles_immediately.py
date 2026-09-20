import pathlib
# §16.5. Settle as soon as the set is signed, so a decision the person could
# still take back is already money. Re-anchored 2026-09-14 (question 46).
# Re-anchored 2026-09-19 for question 68.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (!needsStatement(offer, missing) && offer.decided_at !== null) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false && !needsStatement(offer, missing) && offer.decided_at !== null) {', 1)
p.write_text(s)
