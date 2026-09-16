import pathlib
# §13.2. Accept any 43 base64url characters as a household identifier, so a
# name that is not the encoding of any 32 bytes passes: two such names could
# stand for one household and neither is a name any key has.
p = pathlib.Path('src/common/names.ts'); s = p.read_text()
old = 'const TAIL = "[AEIMQUYcgkosw048]";'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, 'const TAIL = "[A-Za-z0-9_-]";', 1))
