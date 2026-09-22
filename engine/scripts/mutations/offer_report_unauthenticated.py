import pathlib
# §16.3, question 67. Take a decided offer's report from any caller, which
# lets a stranger write rows into the person's copy.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '    if (!reportAuthenticated(hub, request)) throw unauthenticatedReport("only the engine reports a decided offer to the person\'s copy");\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
