import pathlib
# §16.3, §16.5, decided 2026-09-19. A household's decision records nothing,
# so a set it signed is held to the live mandates alone and a lapse ends its
# window and its ceiling.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      this.decidedProtections.set(offer.id, fixed!);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
