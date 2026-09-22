import pathlib
# §6.6, §14.2, question 70. Take a moved correction without the rules one
# appended here meets, signature and ceiling included.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        list.forEach((c, i) => engine.checkCorrection(c, settlement, carriage, list.slice(0, i)));\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
