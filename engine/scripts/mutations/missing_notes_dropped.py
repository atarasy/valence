import pathlib
# §11.2, question 46 R2. The note is checked and then not kept, so it never
# reaches either export.
p = pathlib.Path('src/engine/physical.ts'); s = p.read_text()
old = '    row.missing_notes = Object.fromEntries(missing.map((id) => [id, notes[id]!]));'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    row.missing_notes = {};', 1)
p.write_text(s)
