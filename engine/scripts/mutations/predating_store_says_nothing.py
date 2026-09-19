import pathlib
# §14.2, question 66. Open a store that predates the record without telling
# its operator, so the one signal that it is to be rebuilt never reaches one.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '        console.warn(`valence: ${settledBefore} settlements predate the record'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        void (`valence: ${settledBefore} settlements predate the record', 1)
p.write_text(s)
