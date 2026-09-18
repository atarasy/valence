import pathlib
# §14.2, question 61. Take a payment row of any shape.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          throw badRequest("malformed", "a payment names its presenter and receipt, and its moment and amount are whole numbers");\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
