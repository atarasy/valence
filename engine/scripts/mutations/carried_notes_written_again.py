import pathlib
# §14.2, question 59. Write the notes on an offer already carried a second
# time, so each move repeats the household's notes on what it already brought.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        body_.notes = (body_.notes ?? []).filter((r) => !heldCandidates.has(r.candidate));\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
