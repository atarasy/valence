import pathlib
# §14.2, question 70. Skip comparing a carried offer's corrections, so a
# repeated import can add one the merchant never appended here.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          if (arriving && !isDeepStrictEqual(engine.correctionsFor(id), arriving)) throw differs("corrections for", id);\n          delete arrivingCorrections[id];\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
