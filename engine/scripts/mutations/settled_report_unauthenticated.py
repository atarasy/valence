import pathlib
# §16.3, question 67. Take a settlement report from any caller, which lets a
# stranger fill a household's day past its ceiling.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '      if (!reportAuthenticated(hub, request)) throw unauthenticatedReport("only the engine reports a settlement to the person\'s day");\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
