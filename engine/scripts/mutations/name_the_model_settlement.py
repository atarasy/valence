import pathlib
# Clause 3, the settlement side: the settlement record is built in the engine,
# not in the HTTP view, so a model named here does not show in the offer view.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = '      receipt: createHash("sha256")'
assert old in s
s = s.replace(old,
              '      // mutation\n      ...({ model: "gpt-5" } as Record<string, never>),\n' + old, 1)
p.write_text(s)
