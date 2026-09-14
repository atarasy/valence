import pathlib
# §16.5, §11.2. A cooling window resets a line the collection recorded missing,
# so the household can sign kept or leave it open over goods reported gone.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '    const recorded = new Set([...(recovery?.returned ?? []), ...(recovery?.consumed ?? []), ...(recovery?.missing ?? [])]);'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const recorded = new Set([...(recovery?.returned ?? []), ...(recovery?.consumed ?? [])]);', 1)
p.write_text(s)
