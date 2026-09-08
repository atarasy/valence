import pathlib
p = pathlib.Path("src/permissions.ts"); s = p.read_text()
old = "    permission.revoked_at = now;\n    return permission;"
assert old in s, "anchor drifted"
s = s.replace(old, "    for (const p of list) p.revoked_at = now;\n    return permission;", 1)
p.write_text(s)
