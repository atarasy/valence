import pathlib
# §16.1, question 52. Let an import name a mandate id the host holds for another
# household, which `record` refuses as a mandate changing hands. Every value the
# taking body needs is tighter, so it can be chosen without knowing the held row.
p = pathlib.Path('src/http.ts'); s = p.read_text()
old = '        if (held && held.household !== m.household) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '        if (false) {\n', 1))
