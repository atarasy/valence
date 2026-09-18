import pathlib
# §14.2, question 59. Refuse an offer this host holds even when it arrives
# identical, so a second move from the host a first move left something at is
# refused on every offer the first move already carried.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      if (isDeepStrictEqual(existing, offer)) return;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
