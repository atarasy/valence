import pathlib
p = pathlib.Path("src/hub/permissions.ts"); s = p.read_text()
old = "    permission.revoked_at = now;\n    return permission;"
assert old in s, "anchor drifted"
s = s.replace(old, """    permission.revoked_at = now;
    this.rows.set(household, list.filter((p) => p.id !== id));
    return permission;""", 1)
p.write_text(s)
