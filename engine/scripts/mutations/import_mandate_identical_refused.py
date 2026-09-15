import pathlib
# §14.2, question 52. Refuse a mandate the host holds even when the import
# carries the same one, so a node whose mandate a hub already recorded cannot
# move.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        const held = engine.mandates.get(m.id);\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, old + '        if (held) throw conflict("bad_state", `mandate ${m.id} is already here`);\n', 1))
