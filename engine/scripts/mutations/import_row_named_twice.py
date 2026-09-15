import pathlib
# §14.2, question 52. Accept a body naming one row twice, so a revoked
# permission beside a live copy of itself reads as revoked and goes on
# granting, and a receipt is stored twice.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          if (seen.has(id)) throw badRequest("malformed", `${field} names ${id} twice`);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
