import pathlib
# §14.2, question 52. Refuse a mandate the host holds even when the import
# carries the same one, so a node whose mandate a hub already recorded cannot
# move.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        const held = carryingMandates.get(m.id) ?? engine.mandates.get(m.id);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, old + '        if (engine.mandates.get(m.id)) throw conflict("bad_state", `mandate ${m.id} is already here`);\n', 1)
p.write_text(s)
