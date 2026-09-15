import pathlib
# §7.1, question 52. Stop checking an edge's field types, so `kind: ["gift"]`
# encodes to the bytes a gift does, verifies, and is stored as a list.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (strings.some((v) => typeof v !== "string") || !LINEAGE_KINDS.includes(e.kind)) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        if (false) {\n', 1)
p.write_text(s)
