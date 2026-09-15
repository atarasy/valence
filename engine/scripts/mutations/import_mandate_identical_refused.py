import pathlib
# §14.2, question 52. Refuse a mandate the host holds even when it is the same
# mandate, so a node whose mandate a hub already recorded cannot move.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (held && stable(held) !== stable(m)) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        if (held) {\n', 1)
p.write_text(s)
