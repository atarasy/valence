import pathlib
p = pathlib.Path("src/hub/permissions.ts"); s = p.read_text()
old = "    if (input.grantee === input.household) {"
assert old in s, "anchor drifted"
s = s.replace(old, "    if (false) {", 1); p.write_text(s)
