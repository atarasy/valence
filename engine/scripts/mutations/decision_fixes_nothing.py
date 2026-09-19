import pathlib
# §16.3, §16.5, decided 2026-09-19. A household's decision records nothing,
# so a set it signed is held to the live mandates alone and a lapse ends its
# window and its ceiling.
# Re-anchored 2026-09-20 when the record moved past the report to the day, so
# that a decision refused after it writes nothing (§10.5).
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (offer.state === "decided") this.decidedProtections.set(offer.id, fixed!);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
