import pathlib
# §16.1, question 52. Take an older mandate version over a newer one, which puts
# a captured version back in play at the version after it.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = ' || m.version < held.version'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
