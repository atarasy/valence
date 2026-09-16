import pathlib
# §13.2. Let a malformed percent sequence out of the router unnamed, which is a
# 500 where a refusal that names itself belongs. Six routes gained a decoded
# path segment with question 55 and two had one already.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '    throw badRequest("malformed", "this path is not valid percent-encoding");\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    throw new Error("bad path");\n', 1))
