import pathlib
# §14.2, question 59. Take a collection for an offer already carried without
# comparing it to the one this host holds.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          if (!held || !isDeepStrictEqual(held, arriving)) throw differs("collection for", c.offer);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
