import pathlib
# §14.2, question 57. Keep the confirmation register of an offer left
# behind, so the register names an offer the body does not carry and the
# whole move is refused as unscoped.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (body_.confirmations) for (const id of leftBehind) delete body_.confirmations[id];\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
