import pathlib
# §14.2, question 59. Merge confirmation tokens for an offer already carried
# without asking whether this host holds them.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '          if (tokens && tokens.some((t) => !(heldTokens[id] ?? []).includes(t))) throw differs("confirmation for", id);\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
old = '        if (body_.confirmations) for (const id of alreadyHere) delete body_.confirmations[id];\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
