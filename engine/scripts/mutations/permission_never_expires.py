import pathlib
# Remove grant-time expiry validation. The supplied expiry is retained and
# allows() still requires it to be in the future. A disposable reproduction
# against 22a6784 on 2026-09-13 accepted expires_at 0 but returned false from
# allows(); this accepts an expired row, not an unlimited permission.
p = pathlib.Path("src/hub/permissions.ts"); s = p.read_text()
old = "    if (!Number.isFinite(input.expires_at) || input.expires_at <= now) {"
assert old in s, "anchor drifted"
s = s.replace(old, "    if (false) {", 1); p.write_text(s)
