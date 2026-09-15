import pathlib
# Clause 9, question 52. Take an imported grant whose scope names nothing, which
# `grant` refuses. Every later read of that household's permissions then raises,
# and no revocation can remove the row.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (!Array.isArray(g.scope) || g.scope.length === 0 || g.scope.some((f) => typeof f !== "string")) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '        if (false) {\n', 1)
p.write_text(s)
