import pathlib
# §14.2, question 50. Take the register in after the edges again, so an import
# refused at an edge leaves its offers written with no register.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = """        if (Object.hasOwn(register, offer.id)) {
          engine.importConfirmations({ [offer.id]: register[offer.id]! });
        }
"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
anchor = '      engine.recoveries.importRows(body_.collections ?? []);\n'
assert s.count(anchor) == 1, "anchor drifted"
s = s.replace(anchor, anchor + '      engine.importConfirmations(register);\n', 1)
p.write_text(s)
