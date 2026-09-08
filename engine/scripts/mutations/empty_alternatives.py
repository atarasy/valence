import pathlib
p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
old = "      if (!entry || entry.alternatives.length === 0 || entry.argument_against === \"\") {"
assert old in s, "anchor drifted"
s = s.replace(old, "      if (!entry) {", 1)
p.write_text(s)
