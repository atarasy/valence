import pathlib
p = pathlib.Path("src/registry.ts"); s = p.read_text()
old = "    const entry = this.entries.get(merchant);\n    if (!entry) throw notFound(`no entry for ${merchant}`);\n    return entry;"
assert old in s, "anchor drifted"
s = s.replace(old, "    throw notFound(`no entry for ${merchant}`);", 1)
p.write_text(s)
