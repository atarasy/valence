import pathlib
p = pathlib.Path("src/registry.ts"); s = p.read_text()
old = "      .sort((a, b) => (a.merchant < b.merchant ? -1 : a.merchant > b.merchant ? 1 : 0));"
assert old in s, "anchor drifted"
s = s.replace(old, "      .sort((a, b) => a.registered_at - b.registered_at);", 1)
p.write_text(s)
