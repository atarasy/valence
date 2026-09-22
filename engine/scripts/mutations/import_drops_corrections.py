import pathlib
# §14.2, question 70. Accept a move's corrections and write none of them.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        engine.importCorrections(arrivingCorrections);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
