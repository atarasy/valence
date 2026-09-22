import pathlib
# §16.3, question 67. The engine reports without presenting its credential,
# so every settlement it makes is refused by a hub in another process.
p = pathlib.Path('src/engine/day-source.ts'); s = p.read_text()
old = '    if (this.credential) headers.authorization = `Bearer ${this.credential}`;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
