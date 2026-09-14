import pathlib
# §11.2, question 46 R3. The household's `returned` stands over what the
# collection found used or gone, and the box settles at nothing.
p = pathlib.Path('src/engine/physical.ts'); s = p.read_text()
old = '    if (candidate.valence !== "offered" && !overruled) continue;'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (candidate.valence !== "offered") continue;', 1)
p.write_text(s)
