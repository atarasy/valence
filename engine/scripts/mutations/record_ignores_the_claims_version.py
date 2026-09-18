import pathlib
# §14.2 and §16.1, question 56. Ignore the version a claim arrived at, so a
# mandate amended where it came from can never be signed here: its holder is
# asked for a version 1 they never agreed to.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    if (claim && mandate.version !== claim.version) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    if (false) {\n', 1))
