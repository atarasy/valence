import pathlib
p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
old = "        argument_against: entry.argument_against,"
assert old in s, "anchor drifted"
s = s.replace(old, "        argument_against: `<div class=\"warn\">${entry.argument_against}</div>`,", 1)
p.write_text(s)
