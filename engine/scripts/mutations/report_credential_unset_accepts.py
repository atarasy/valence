import pathlib
# §16.3, question 67. A hub given no credential takes every report, which is
# the shape the route had before the question was decided.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '  if (!hub.reportCredential) return false;\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '  if (!hub.reportCredential) return true;\n', 1)
p.write_text(s)
