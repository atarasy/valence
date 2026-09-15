import pathlib
# §14.2, question 52. Accept a body naming one mandate twice. A looser second
# row then takes the tighter first out of the import with it, and the household
# lands with no mandate at all.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (seenMandates.has(m.id)) throw badRequest("malformed", `mandates names ${m.id} twice`);\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
