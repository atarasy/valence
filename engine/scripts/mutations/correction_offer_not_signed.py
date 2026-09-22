import pathlib
# §6.6, question 70. Leave the offer out of the signed bytes, so a correction
# signed for one offer can be filed under another.
p = pathlib.Path('src/shared/correction.ts'); s = p.read_text()
old = '    encodeURIComponent(c.offer),\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
