import pathlib
# §14.2, question 52. Refuse a held mandate even when the import carries the
# same one, so a node whose mandate a hub already recorded cannot move.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (held && stable(held) !== stable(m) && (held.version ?? 0) < (m.version ?? 0)) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        if (held) {\n', 1)
p.write_text(s)
