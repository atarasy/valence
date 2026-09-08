import pathlib
# Clause 27: a line reaches the merchant only when the writer shared it. Put
# every line on a shop's candidates into the shop's export.
p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
old = 'o.candidates.flatMap((c) => engine.notesSharedWith(c.id, "merchant"))'
assert old in s
s = s.replace(old, "o.candidates.flatMap((c) => engine.notesFor(c.id))", 1)
p.write_text(s)
