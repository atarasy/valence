import pathlib
# §16.3, question 67. Accept any bearer credential rather than the engine's.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '  return timingSafeEqual(given, expected);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '  return (request.headers.get("authorization") ?? "").startsWith("Bearer ");\n', 1)
p.write_text(s)
