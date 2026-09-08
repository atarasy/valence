import pathlib
p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
old = "      excluded: deliberation.excluded,"
assert old in s, "anchor drifted"
s = s.replace(old, "      excluded: [],", 1); p.write_text(s)
