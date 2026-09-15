import pathlib
# §16.1, question 52. Stop checking a mandate's field types on import, so a
# lapse of "never" imports and no read ever finds the mandate lapsed.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          typeof m.lapses_at !== "number" || typeof m.version !== "number" ||\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '          false ||\n', 1))
