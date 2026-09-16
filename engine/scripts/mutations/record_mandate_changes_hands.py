import pathlib
# §16.1. Let a recorded version change a mandate's household, on a row a host
# running the older rule holds: the shape check above cannot reach it, and it
# is what keeps such a row from being taken over by its identifier's owner.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    if (before && before.household !== mandate.household) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    if (false) {\n', 1))
