import pathlib
# §16.1, question 52. Take a mandate whose numbers are not whole and in range,
# which `record` refuses: a lapse of -5, a version of 1.5, a null ceiling.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          !whole(m.lapses_at, 0) || !whole(m.version, 1) ||\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '          false ||\n', 1))
