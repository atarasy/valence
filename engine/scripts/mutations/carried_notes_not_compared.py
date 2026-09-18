import pathlib
# §14.2, question 59. Take a note on a candidate already carried without
# comparing it to the notes this host holds, so a body repeating an offer can
# put words in the household's hand.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          if (heldCandidates.has(n.candidate) && !engine.notesFor(n.candidate).some((h) => isDeepStrictEqual(h, n))) throw differs("note on", n.candidate);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
old = '        body_.notes = (body_.notes ?? []).filter((r) => !heldCandidates.has(r.candidate));\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
