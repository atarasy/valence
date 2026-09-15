import pathlib
# §16.1, question 52. Take a later mandate version whatever it says, so a move
# can loosen a mandate the host holds without the co-signers a change needs.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (held && looser(m, held)) taken.delete(m.id);\n        else carryingMandates.set(m.id, m);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        carryingMandates.set(m.id, m);\n', 1)
p.write_text(s)
