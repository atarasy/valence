import pathlib
p = pathlib.Path("src/registry.ts"); s = p.read_text()
old = "  mark: boolean;\n  signature: string;\n  registered_at: number;\n};"
assert old in s, "anchor drifted"
s = s.replace(old, "  mark: boolean;\n  products?: string[];\n  signature: string;\n  registered_at: number;\n};", 1)
old2 = "      mark: input.mark,\n      signature: input.signature,"
assert old2 in s, "anchor drifted (register)"
s = s.replace(old2, "      mark: input.mark,\n      products: [\"tea-a\", \"tea-b\"],\n      signature: input.signature,", 1)
p.write_text(s)
