import pathlib
# §14.2, question 57. Keep the notes on an offer left behind, so a note
# names a candidate the body no longer carries and the whole move is refused.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        body_.notes = (body_.notes ?? []).filter((r) => !behindCandidates.has(r.candidate));\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '', 1))
