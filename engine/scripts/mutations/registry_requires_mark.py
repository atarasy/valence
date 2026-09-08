import pathlib
p = pathlib.Path("src/registry.ts"); s = p.read_text()
old = "      .filter((e) => !input.markOnly || e.mark)"
assert old in s, "anchor drifted"
s = s.replace(old, "      .filter((e) => e.mark)", 1)
p.write_text(s)
