import pathlib
# §14.2, question 51. Forget the offers the same body has already been checked
# as bringing, so a body naming one offer twice writes the first before the
# second is refused.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    if (carrying?.offers.has(offer.id)) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false) {\n', 1)
p.write_text(s)
