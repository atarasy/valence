import pathlib
# §12, question 58. Join the gift's names unescaped, so a name holding the
# separator makes two sets of terms one set of bytes.
p = pathlib.Path('src/shared/gift.ts'); s = p.read_text()
old = '  const name = (v: string) => encodeURIComponent(v);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '  const name = (v: string) => v;\n', 1)
p.write_text(s)
