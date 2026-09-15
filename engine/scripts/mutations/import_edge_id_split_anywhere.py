import pathlib
# §7.1, question 52. Treat any tilde in an edge's id as one this host wrote, so
# an edge posted as `gift~2026` is filed as `gift` and stays renamed.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = "    const derivedForm = /^(.*)~[0-9a-f]{16}(?:~\\d+)?$/.exec(edge.id);\n    const base = derivedForm ? derivedForm[1]! : edge.id;\n"
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    const base = edge.id.includes("~") ? edge.id.slice(0, edge.id.indexOf("~")) : edge.id;\n', 1))
