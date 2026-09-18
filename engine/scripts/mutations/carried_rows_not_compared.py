import pathlib
# §14.2, question 59. Take a settlement for an offer already carried without
# comparing it to the one this host holds, so a body repeating an offer can
# change what the receiving host recorded it was charged.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          if (alreadyHere.has(s_.offer) && !isDeepStrictEqual(engine.settlement(s_.offer), s_)) throw differs("settlement for", s_.offer);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
old = '        body_.settlements = (body_.settlements ?? []).filter((r) => !alreadyHere.has(r.offer));\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
