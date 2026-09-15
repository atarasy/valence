import pathlib
# §16, question 54. Read the mandate an offer names whoever it belongs to, so an
# offer takes another household's ceilings, cooling window and co-signers.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (mandate && mandate.household !== offer.household) return undefined;\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
