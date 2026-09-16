import pathlib
# §16.2, question 56. Read a hub's answer about a household's mandates as
# "there are none" whenever it is not a clean `has: true`, so a transport
# failure, a 404 from an older hub or a 200 of the wrong shape all drop the
# protection and a phantom-labelled offer presents.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = '    const has = (body as { has?: unknown } | null)?.has;\n    if (typeof has !== "boolean") {'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    const has = (body as { has?: unknown } | null)?.has === true;\n    if (false) {', 1))
