import pathlib
p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
old = "      mandate: deliberation.mandate,"
assert old in s, "anchor drifted"
s = s.replace(old, "      mandate: { ...deliberation.mandate, scope: \"\" },", 1)
p.write_text(s)
