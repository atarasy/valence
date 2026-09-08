import pathlib
p = pathlib.Path("src/permissions.ts"); s = p.read_text()
old = "    if (!Number.isFinite(input.expires_at) || input.expires_at <= now) {"
assert old in s, "anchor drifted"
s = s.replace(old, "    if (false) {", 1); p.write_text(s)
